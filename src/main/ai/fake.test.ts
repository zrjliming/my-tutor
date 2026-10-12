import { describe, it, expect } from 'vitest'
import { FakeAIProvider } from './fake'
import { LessonExtractionSchema } from '@shared/schemas'
import type { ChatEvent } from '@shared/types'

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('FakeAIProvider', () => {
  it('streams the reply word by word then emits done with structured output', async () => {
    const fake = new FakeAIProvider({ reply: { reply: 'Hello there friend' } })
    const events = await collect(
      fake.chat({
        conversationId: 'c1',
        firstTurn: true,
        systemPrompt: 's',
        text: 'hi',
        signal: new AbortController().signal
      })
    )
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e.type === 'text_delta' ? e.text : ''))
      .join('')
    expect(text).toBe('Hello there friend')
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type === 'done') expect(done.structured?.reply).toBe('Hello there friend')
    expect(fake.calls[0]?.text).toBe('hi')
  })
  it('emits error when configured to fail', async () => {
    const fake = new FakeAIProvider({ failWith: 'not_logged_in' })
    const events = await collect(
      fake.chat({
        conversationId: 'c1',
        firstTurn: true,
        text: 'hi',
        signal: new AbortController().signal
      })
    )
    expect(events).toEqual([{ type: 'error', kind: 'not_logged_in', message: expect.any(String) }])
  })
  it('stops with aborted when the signal fires', async () => {
    const fake = new FakeAIProvider({
      reply: { reply: 'one two three four five' },
      deltaDelayMs: 5
    })
    const ac = new AbortController()
    const events: ChatEvent[] = []
    for await (const e of fake.chat({
      conversationId: 'c1',
      firstTurn: true,
      text: 'hi',
      signal: ac.signal
    })) {
      events.push(e)
      if (events.length === 2) ac.abort()
    }
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'aborted', message: expect.any(String) })
  })
  it('analyze returns the configured object after validating it against the schema', async () => {
    const fake = new FakeAIProvider({
      analyzeResult: { title: 'L5', body: 'Hi.', vocabulary: [], notesZh: '' }
    })
    const r = await fake.analyze({ systemPrompt: 's', text: 't', schema: LessonExtractionSchema })
    expect(r.title).toBe('L5')
    expect(fake.analyzeCalls).toHaveLength(1)
  })
  it('records deleted sessions and answers check', async () => {
    const fake = new FakeAIProvider()
    await fake.deleteSession('c1')
    expect(fake.deleted).toEqual(['c1'])
    expect((await fake.check()).ok).toBe(true)
  })
})
