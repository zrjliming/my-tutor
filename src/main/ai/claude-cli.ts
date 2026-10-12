import {
  query,
  deleteSession,
  type Options,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodType } from 'zod'
import { TutorResponseSchema } from '@shared/schemas'
import type {
  AICheckResult,
  AIErrorKind,
  ChatEvent,
  ImageInput,
  TutorResponse
} from '@shared/types'
import { AIError, type AIProvider, type AnalyzeRequest, type ChatRequest } from './types'
import { cleanEnv } from './env'
import { toJsonSchema } from './json-schema'

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options?: Options
}) => AsyncIterable<SDKMessage>

export interface ClaudeCliProviderOptions {
  sessionsDir: string
  queryFn?: QueryFn
  deleteSessionFn?: (id: string, o: { dir: string }) => Promise<void>
  env?: NodeJS.ProcessEnv
}

const TUTOR_JSON_SCHEMA = toJsonSchema(TutorResponseSchema)
const CheckSchema = z.object({ ok: z.boolean() })

async function* userMessage(
  text: string,
  images: ImageInput[] = []
): AsyncIterable<SDKUserMessage> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
  for (const img of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.base64 }
    })
  }
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content }
  } as unknown as SDKUserMessage
}

export function classifyError(message: string): AIErrorKind {
  const m = message.toLowerCase()
  if (m.includes('native cli binary') || m.includes('enoent')) return 'binary_missing'
  if (
    m.includes('not logged in') ||
    m.includes('/login') ||
    m.includes('authentication') ||
    m.includes('unauthorized')
  )
    return 'not_logged_in'
  if (m.includes('rate limit') || m.includes('429') || m.includes('overloaded'))
    return 'rate_limited'
  if (
    m.includes('network') ||
    m.includes('econn') ||
    m.includes('fetch failed') ||
    m.includes('timeout')
  )
    return 'network'
  return 'unknown'
}

export class ClaudeCliProvider implements AIProvider {
  private readonly queryFn: QueryFn
  private readonly deleteSessionFn: (id: string, o: { dir: string }) => Promise<void>

  constructor(private readonly opts: ClaudeCliProviderOptions) {
    this.queryFn = opts.queryFn ?? (query as unknown as QueryFn)
    this.deleteSessionFn = opts.deleteSessionFn ?? deleteSession
  }

  private baseOptions(signal: AbortSignal | undefined, model: string | undefined): Options {
    const abortController = new AbortController()
    if (signal) {
      if (signal.aborted) abortController.abort()
      else signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }
    return {
      settingSources: [],
      tools: [],
      permissionMode: 'dontAsk',
      cwd: this.opts.sessionsDir,
      env: cleanEnv(this.opts.env ?? process.env),
      abortController,
      maxTurns: 3,
      ...(model ? { model } : {})
    }
  }

  private async *run(
    prompt: AsyncIterable<SDKUserMessage>,
    options: Options,
    schema: ZodType,
    onInit?: (model: string) => void
  ): AsyncIterable<ChatEvent> {
    let text = ''
    try {
      for await (const m of this.queryFn({ prompt, options })) {
        if (m.type === 'stream_event') {
          const ev = m.event as { type: string; delta?: { type: string; text?: string } }
          if (
            ev.type === 'content_block_delta' &&
            ev.delta?.type === 'text_delta' &&
            ev.delta.text
          ) {
            text += ev.delta.text
            yield { type: 'text_delta', text: ev.delta.text }
          }
        } else if (m.type === 'system') {
          const sys = m as unknown as { subtype: string; attempt?: number; model?: string }
          if (sys.subtype === 'init' && sys.model) onInit?.(sys.model)
          else if (sys.subtype === 'api_retry')
            yield { type: 'retrying', attempt: sys.attempt ?? 1 }
        } else if (m.type === 'result') {
          if (m.subtype === 'success') {
            const parsed = schema.safeParse(m.structured_output)
            const rawText = text || (typeof m.result === 'string' ? m.result : '')
            yield {
              type: 'done',
              structured: parsed.success ? (parsed.data as TutorResponse) : undefined,
              rawText
            }
          } else {
            const errs = (m as unknown as { errors?: string[] }).errors
            const message = errs?.length ? errs.join('; ') : m.subtype
            yield { type: 'error', kind: classifyError(message), message }
          }
        }
      }
    } catch (e) {
      const err = e as Error
      const kind: AIErrorKind =
        err?.name === 'AbortError' || options.abortController?.signal.aborted
          ? 'aborted'
          : classifyError(String(err?.message ?? e))
      yield { type: 'error', kind, message: String(err?.message ?? e) }
    }
  }

  chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const options: Options = {
      ...this.baseOptions(req.signal, req.model),
      includePartialMessages: true,
      outputFormat: { type: 'json_schema', schema: TUTOR_JSON_SCHEMA },
      ...(req.firstTurn
        ? { sessionId: req.conversationId, systemPrompt: req.systemPrompt }
        : { resume: req.conversationId })
    }
    return this.run(userMessage(req.text), options, TutorResponseSchema)
  }

  async analyze<T>(req: AnalyzeRequest<T>): Promise<T> {
    const options: Options = {
      ...this.baseOptions(req.signal, req.model),
      systemPrompt: req.systemPrompt,
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: toJsonSchema(req.schema) }
    }
    for await (const ev of this.run(userMessage(req.text, req.images), options, req.schema)) {
      if (ev.type === 'done') {
        if (ev.structured === undefined) throw new AIError('unknown', '模型没有返回结构化结果')
        return ev.structured as T
      }
      if (ev.type === 'error') throw new AIError(ev.kind, ev.message)
    }
    throw new AIError('unknown', '调用结束但没有结果')
  }

  async deleteSession(conversationId: string): Promise<void> {
    try {
      await this.deleteSessionFn(conversationId, { dir: this.opts.sessionsDir })
    } catch {
      // best-effort
    }
  }

  async check(): Promise<AICheckResult> {
    const started = Date.now()
    let model: string | undefined
    const options: Options = {
      ...this.baseOptions(undefined, undefined),
      systemPrompt: 'Reply with ok=true.',
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: toJsonSchema(CheckSchema) }
    }
    for await (const ev of this.run(
      userMessage('ping'),
      options,
      CheckSchema,
      (m) => (model = m)
    )) {
      if (ev.type === 'done')
        return { ok: true, model, durationMs: Date.now() - started, message: '连接正常' }
      if (ev.type === 'error')
        return { ok: false, model, durationMs: Date.now() - started, message: ev.message }
    }
    return { ok: false, message: '没有收到结果' }
  }
}
