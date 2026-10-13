import type { AICheckResult, AIErrorKind, ChatEvent, TutorResponse } from '@shared/types'
import { AIError, type AIProvider, type AnalyzeRequest, type ChatRequest } from './types'

export interface FakeAIOptions {
  reply?: TutorResponse
  analyzeResult?: unknown
  /** analyze() 返回第一个通过所请求 schema 校验的候选；都不匹配时退回 analyzeResult。 */
  analyzeCandidates?: unknown[]
  failWith?: AIErrorKind
  deltaDelayMs?: number
  omitStructured?: boolean
  /** 设置后 chat() 原样产出这串事件（忽略 reply/failWith），用于脚本化边界情况。 */
  events?: ChatEvent[]
}

const DEFAULT_REPLY: TutorResponse = {
  reply: 'Nice to meet you! What did you do today?',
  correction: {
    original: 'I goed to work',
    improved: 'I went to work',
    explanationZh: 'go 的过去式是 went。',
    category: 'grammar'
  },
  vocabulary: [{ word: 'commute', meaningZh: '通勤', example: 'My commute takes 40 minutes.' }]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class FakeAIProvider implements AIProvider {
  calls: ChatRequest[] = []
  analyzeCalls: AnalyzeRequest<unknown>[] = []
  deleted: string[] = []

  constructor(private readonly opts: FakeAIOptions = {}) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    this.calls.push(req)
    if (this.opts.events) {
      for (const ev of this.opts.events) yield ev
      return
    }
    if (this.opts.failWith) {
      yield {
        type: 'error',
        kind: this.opts.failWith,
        message: `fake failure: ${this.opts.failWith}`
      }
      return
    }
    const reply = this.opts.reply ?? DEFAULT_REPLY
    const words = reply.reply.split(' ')
    for (let i = 0; i < words.length; i++) {
      if (this.opts.deltaDelayMs) await sleep(this.opts.deltaDelayMs)
      if (req.signal.aborted) {
        yield { type: 'error', kind: 'aborted', message: 'aborted' }
        return
      }
      yield { type: 'text_delta', text: (i === 0 ? '' : ' ') + words[i] }
    }
    yield {
      type: 'done',
      structured: this.opts.omitStructured ? undefined : reply,
      rawText: reply.reply
    }
  }

  async analyze<T>(req: AnalyzeRequest<T>): Promise<T> {
    this.analyzeCalls.push(req as AnalyzeRequest<unknown>)
    if (this.opts.failWith)
      throw new AIError(this.opts.failWith, `fake failure: ${this.opts.failWith}`)
    for (const candidate of this.opts.analyzeCandidates ?? []) {
      const c = req.schema.safeParse(candidate)
      if (c.success) return c.data
    }
    const parsed = req.schema.safeParse(this.opts.analyzeResult)
    if (!parsed.success) throw new AIError('unknown', 'fake analyzeResult does not match schema')
    return parsed.data
  }

  async deleteSession(conversationId: string): Promise<void> {
    this.deleted.push(conversationId)
  }

  async check(): Promise<AICheckResult> {
    return { ok: true, model: 'fake', durationMs: 1, message: 'FakeAIProvider' }
  }
}
