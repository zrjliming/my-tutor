import { describe, it, expect, vi } from 'vitest'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCliProvider, type QueryFn } from './claude-cli'
import { LessonExtractionSchema } from '@shared/schemas'
import type { ChatEvent } from '@shared/types'

type Captured = { prompt: SDKUserMessage[]; options: Options | undefined }

function fakeQuery(script: (captured: Captured) => SDKMessage[] | Promise<SDKMessage[]>): {
  fn: QueryFn
  captured: Captured
} {
  const captured: Captured = { prompt: [], options: undefined }
  const fn: QueryFn = ({ prompt, options }) => {
    captured.options = options
    return (async function* () {
      for await (const m of prompt) captured.prompt.push(m)
      for (const m of await script(captured)) yield m
    })()
  }
  return { fn, captured }
}

const delta = (text: string): SDKMessage =>
  ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent_tool_use_id: null,
    uuid: 'u',
    session_id: 's'
  }) as unknown as SDKMessage
const init = (model = 'claude-x'): SDKMessage =>
  ({
    type: 'system',
    subtype: 'init',
    model,
    session_id: 's',
    apiKeySource: 'none'
  }) as unknown as SDKMessage
const success = (structured: unknown, result = ''): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    structured_output: structured,
    result,
    is_error: false,
    num_turns: 2,
    session_id: 's',
    usage: {}
  }) as unknown as SDKMessage
const failure = (subtype: string, errors: string[]): SDKMessage =>
  ({ type: 'result', subtype, errors, is_error: true, session_id: 's' }) as unknown as SDKMessage
const retry = (attempt: number): SDKMessage =>
  ({
    type: 'system',
    subtype: 'api_retry',
    attempt,
    max_retries: 3,
    session_id: 's'
  }) as unknown as SDKMessage

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const sig = (): AbortSignal => new AbortController().signal

describe('ClaudeCliProvider.chat', () => {
  it('first turn passes sessionId + systemPrompt and the mandatory options', async () => {
    const { fn, captured } = fakeQuery(() => [init(), delta('Hi'), success({ reply: 'Hi' })])
    const p = new ClaudeCliProvider({
      sessionsDir: '/tmp/s',
      queryFn: fn,
      env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'x' }
    })
    const events = await collect(
      p.chat({
        conversationId: 'conv-1',
        firstTurn: true,
        systemPrompt: 'SYS',
        text: 'hello',
        signal: sig(),
        model: 'sonnet'
      })
    )
    const o = captured.options!
    expect(o.sessionId).toBe('conv-1')
    expect(o.resume).toBeUndefined()
    expect(o.systemPrompt).toBe('SYS')
    expect(o.settingSources).toEqual([])
    expect(o.tools).toEqual([])
    expect(o.disallowedTools).toBeUndefined()
    expect(o.permissionMode).toBe('dontAsk')
    expect(o.cwd).toBe('/tmp/s')
    expect(o.pathToClaudeCodeExecutable).toBeUndefined()
    expect(o.includePartialMessages).toBe(true)
    expect(o.model).toBe('sonnet')
    expect(o.outputFormat).toMatchObject({ type: 'json_schema' })
    expect((o.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined()
    expect(captured.prompt[0]?.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hi' },
      { type: 'done', structured: { reply: 'Hi' }, rawText: 'Hi' }
    ])
  })
  it('later turns resume and send no system prompt', async () => {
    const { fn, captured } = fakeQuery(() => [init(), success({ reply: 'ok' })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    await collect(p.chat({ conversationId: 'conv-1', firstTurn: false, text: 'x', signal: sig() }))
    expect(captured.options!.resume).toBe('conv-1')
    expect(captured.options!.sessionId).toBeUndefined()
    expect(captured.options!.systemPrompt).toBeUndefined()
  })
  it('degrades to plain text when structured output is missing or invalid', async () => {
    const { fn } = fakeQuery(() => [init(), delta('Plain '), delta('text'), success({ nope: 1 })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events.at(-1)).toEqual({ type: 'done', structured: undefined, rawText: 'Plain text' })
  })
  it('uses result text as rawText when nothing streamed', async () => {
    const { fn } = fakeQuery(() => [init(), success(undefined, 'from result')])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events.at(-1)).toEqual({ type: 'done', structured: undefined, rawText: 'from result' })
  })
  it('stops consuming the SDK stream once a result arrives', async () => {
    let consumedAfterResult = false
    const fn: QueryFn = () =>
      (async function* () {
        yield init()
        yield success({ reply: 'ok' })
        consumedAfterResult = true
        yield failure('error_during_execution', ['late'])
      })()
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events).toEqual([{ type: 'done', structured: { reply: 'ok' }, rawText: '' }])
    expect(consumedAfterResult).toBe(false)
  })
  it('stops consuming the SDK stream after an error result', async () => {
    let consumedAfterResult = false
    const fn: QueryFn = () =>
      (async function* () {
        yield failure('error_during_execution', ['boom'])
        consumedAfterResult = true
        yield success({ reply: 'late' })
      })()
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events).toEqual([{ type: 'error', kind: 'unknown', message: 'boom' }])
    expect(consumedAfterResult).toBe(false)
  })
  it('extracts reply from a JSON result string when structured output is invalid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fn } = fakeQuery(() => [
      init(),
      success({ nope: 1 }, '{"reply":"Hi there","vocabulary":"bad"}')
    ])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events.at(-1)).toEqual({ type: 'done', structured: undefined, rawText: 'Hi there' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('maps api_retry to retrying and error results to error kinds', async () => {
    const { fn } = fakeQuery(() => [
      init(),
      retry(1),
      failure('error_during_execution', ['Not logged in. Please run /login'])
    ])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: true, systemPrompt: 's', text: 'x', signal: sig() })
    )
    expect(events[0]).toEqual({ type: 'retrying', attempt: 1 })
    expect(events[1]).toMatchObject({ type: 'error', kind: 'not_logged_in' })
  })
  it('reports aborted when the signal fires mid-stream', async () => {
    const ac = new AbortController()
    const { fn } = fakeQuery(async () => {
      ac.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: ac.signal })
    )
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'aborted' })
  })
  it('reports binary_missing when the SDK throws about the native CLI', async () => {
    const { fn } = fakeQuery(async () => {
      throw new Error('Native CLI binary for darwin-arm64 not found')
    })
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(
      p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() })
    )
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'binary_missing' })
  })
})

describe('ClaudeCliProvider.analyze', () => {
  it('sends images as base64 blocks, does not persist, and returns the parsed object', async () => {
    const lesson = { title: 'L5', body: 'Good morning.', vocabulary: [], notesZh: '' }
    const { fn, captured } = fakeQuery(() => [init(), success(lesson)])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.analyze({
      systemPrompt: 'EXTRACT',
      text: 'see image',
      images: [{ mime: 'image/png', base64: 'QUJD' }],
      schema: LessonExtractionSchema
    })
    expect(r).toEqual(lesson)
    expect(captured.options!.persistSession).toBe(false)
    expect(captured.options!.systemPrompt).toBe('EXTRACT')
    expect(captured.prompt[0]?.message.content).toEqual([
      { type: 'text', text: 'see image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
    ])
  })
  it('throws AIError when the structured output is missing', async () => {
    const { fn } = fakeQuery(() => [init(), success(undefined, 'oops')])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    await expect(
      p.analyze({ systemPrompt: 's', text: 't', schema: LessonExtractionSchema })
    ).rejects.toMatchObject({ name: 'AIError', kind: 'unknown' })
  })
})

describe('ClaudeCliProvider.check / deleteSession', () => {
  it('check reports the model from the init message', async () => {
    const { fn } = fakeQuery(() => [init('claude-opus-5'), success({ ok: true })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.check()
    expect(r.ok).toBe(true)
    expect(r.model).toBe('claude-opus-5')
  })
  it('passes cliPath through as pathToClaudeCodeExecutable', async () => {
    const { fn, captured } = fakeQuery(() => [init(), success({ ok: true })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn, cliPath: '/x/claude' })
    await p.check()
    expect(captured.options!.pathToClaudeCodeExecutable).toBe('/x/claude')
  })
  it('check reports failure without throwing', async () => {
    const { fn } = fakeQuery(() => [failure('error_during_execution', ['authentication failed'])])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.check()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/authentication/)
  })
  it('deleteSession delegates with the sessions dir and swallows errors', async () => {
    const calls: unknown[] = []
    const p = new ClaudeCliProvider({
      sessionsDir: '/tmp/s',
      queryFn: fakeQuery(() => []).fn,
      deleteSessionFn: async (id, o) => {
        calls.push([id, o])
        throw new Error('nope')
      }
    })
    await expect(p.deleteSession('c9')).resolves.toBeUndefined()
    expect(calls).toEqual([['c9', { dir: '/tmp/s' }]])
  })
})
