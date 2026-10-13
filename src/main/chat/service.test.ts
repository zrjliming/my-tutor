import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/index'
import { insertLesson } from '../db/lessons'
import { getConversation, listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from './service'
import { listMistakes, insertMistake } from '../db/mistakes'
import { listVocab } from '../db/vocabulary'
import {
  getPracticeSession,
  markReviewsApplied,
  markSessionEnded,
  saveSessionSummary
} from '../db/practice'
import { saveProfile } from '../db/profile'
import type { ChatIpcEvent, TutorResponse } from '@shared/types'

let db: Db
let events: ChatIpcEvent[]
let n: number
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
]
const DONE_REPLY: TutorResponse = {
  reply: 'Hello',
  correction: {
    original: 'I goed',
    improved: 'I went',
    explanationZh: 'go 的过去式是 went。',
    category: 'grammar'
  },
  vocabulary: [{ word: 'commute', meaningZh: '通勤', example: 'My commute is long.' }]
}
const mk = (ai: FakeAIProvider): ChatService =>
  new ChatService({
    db,
    ai,
    send: (e) => events.push(e),
    // 前几个 id 固定（已有用例按位置引用），之后递增生成，保证错句 / 生词等新行 id 唯一
    uuid: () => {
      const id = ids[n] ?? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
      n++
      return id
    },
    now: () => `2026-10-12T00:00:${String(n).padStart(2, '0')}.000Z`
  })

beforeEach(() => {
  db = openDatabase(':memory:')
  events = []
  n = 0
})

describe('createConversation', () => {
  it('inserts the conversation, runs the opening turn as first turn without a user message', async () => {
    const ai = new FakeAIProvider({ reply: { reply: 'Hi! What did you do today?' } })
    const svc = mk(ai)
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('自由聊天')
    expect(ai.calls[0]).toMatchObject({ conversationId: conversation.id, firstTurn: true })
    expect(ai.calls[0].systemPrompt).toContain('Mode: free chat')
    expect(ai.calls[0].text).toContain('Greet')
    const msgs = listMessages(db, conversation.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({
      id: assistantMessageId,
      role: 'assistant',
      status: 'done',
      content: 'Hi! What did you do today?'
    })
    expect(msgs[0].structured?.reply).toBe('Hi! What did you do today?')
    expect(getConversation(db, conversation.id)?.sessionStarted).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      conversationId: conversation.id,
      messageId: assistantMessageId
    })
    expect(events.filter((e) => e.type === 'text_delta').length).toBeGreaterThan(1)
  })
  it('lesson mode needs an existing lesson and puts its text in the system prompt', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    await expect(svc.createConversation({ mode: 'lesson', lessonId: ids[3] })).rejects.toThrow(
      /课程/
    )
    insertLesson(db, {
      id: ids[3],
      title: 'Lesson 5',
      body: 'Good morning, Mr. Blake.',
      source: 'text',
      notesZh: '',
      vocabulary: [],
      createdAt: 'x',
      assets: []
    })
    const { conversation } = await svc.createConversation({ mode: 'lesson', lessonId: ids[3] })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('Lesson 5')
    expect(ai.calls[0].systemPrompt).toContain('Good morning, Mr. Blake.')
  })
  it('scenario title combines scenario and mode', async () => {
    const svc = mk(new FakeAIProvider())
    const { conversation } = await svc.createConversation({ mode: 'roleplay', scenario: '餐厅' })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('餐厅 · 角色扮演')
  })
})

describe('send', () => {
  it('persists the user message, resumes the session, bumps turn count', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const { userMessage } = await svc.send({
      conversationId: conversation.id,
      text: 'I goed to work',
      fromAsr: true
    })
    await svc.whenIdle(conversation.id)
    expect(userMessage).toMatchObject({
      role: 'user',
      content: 'I goed to work',
      fromAsr: true,
      status: 'done'
    })
    expect(ai.calls[1]).toMatchObject({ firstTurn: false })
    expect(ai.calls[1].systemPrompt).toBeUndefined()
    expect(listMessages(db, conversation.id).map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant'
    ])
    expect(getConversation(db, conversation.id)?.turnCount).toBe(1)
  })
  it('sending into an ended session reopens it and drops the stale summary, keeping reviews_applied', async () => {
    const svc = mk(new FakeAIProvider())
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    markSessionEnded(db, conversation.id, '2026-10-12T01:00:00.000Z')
    saveSessionSummary(db, conversation.id, { practiced: 'p', performanceZh: 'q', issues: [] })
    markReviewsApplied(db, conversation.id)
    await svc.send({ conversationId: conversation.id, text: 'Hi again' })
    await svc.whenIdle(conversation.id)
    expect(getPracticeSession(db, conversation.id)).toMatchObject({
      endedAt: null,
      summary: null,
      reviewsApplied: true
    })
  })
  it('tells the provider an ASR turn came from speech recognition, but stores the raw text', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    await svc.send({ conversationId: conversation.id, text: 'I go to work', fromAsr: true })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1].text).toMatch(/transcribed by speech recognition/)
    expect(ai.calls[1].text).toMatch(/correction\.uncertain = true/)
    expect(ai.calls[1].text.endsWith('\nI go to work')).toBe(true)
    const stored = listMessages(db, conversation.id).find((m) => m.role === 'user')
    expect(stored?.content).toBe('I go to work')
  })
  it('rejects a second send while a turn is in progress', async () => {
    const svc = mk(new FakeAIProvider({ deltaDelayMs: 20 }))
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await expect(svc.send({ conversationId: conversation.id, text: 'again' })).rejects.toThrow(
      /尚未结束/
    )
    await svc.whenIdle(conversation.id)
  })
  it('after a failed opening turn the next send is a first turn again', async () => {
    const ai = new FakeAIProvider({ failWith: 'not_logged_in' })
    const svc = mk(ai)
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(listMessages(db, conversation.id)[0]).toMatchObject({
      id: assistantMessageId,
      status: 'error'
    })
    expect(getConversation(db, conversation.id)?.sessionStarted).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'not_logged_in' })
    await svc.send({ conversationId: conversation.id, text: 'retry' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1]).toMatchObject({ firstTurn: true, text: 'retry' })
    expect(ai.calls[1].systemPrompt).toContain('Learner level')
  })
  it('a stopped opening turn deletes the half-created Claude session so the next send starts fresh', async () => {
    const ai = new FakeAIProvider({
      events: [{ type: 'error', kind: 'aborted', message: 'aborted' }]
    })
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(ai.deleted).toEqual([conversation.id])
    await svc.send({ conversationId: conversation.id, text: 'retry' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1]).toMatchObject({ firstTurn: true })
  })
  it('a stream that ends without done or error is recorded and reported as an error', async () => {
    const svc = mk(new FakeAIProvider({ events: [{ type: 'text_delta', text: 'Hal' }] }))
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m).toMatchObject({ status: 'error', content: 'Hal' })
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      kind: 'unknown',
      messageId: assistantMessageId
    })
  })
  it('stores plain text and null structured when structured output is missing', async () => {
    const svc = mk(new FakeAIProvider({ omitStructured: true, reply: { reply: 'Just text' } }))
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m).toMatchObject({ content: 'Just text', structured: null, status: 'done' })
  })
  it('cancel marks the assistant message stopped and keeps partial text', async () => {
    const svc = mk(
      new FakeAIProvider({ deltaDelayMs: 15, reply: { reply: 'one two three four five six' } })
    )
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await new Promise((r) => setTimeout(r, 40))
    svc.cancel(conversation.id)
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m.status).toBe('stopped')
    expect(m.content.length).toBeGreaterThan(0)
    expect(m.content.length).toBeLessThan('one two three four five six'.length)
  })
  it('ignores events after done: a late aborted does not overwrite the saved reply', async () => {
    const reply = DONE_REPLY
    const svc = mk(
      new FakeAIProvider({
        events: [
          { type: 'text_delta', text: 'Hello' },
          { type: 'done', structured: reply, rawText: 'Hello' },
          { type: 'error', kind: 'aborted', message: 'aborted' }
        ]
      })
    )
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m).toMatchObject({ status: 'done', content: 'Hello', structured: reply })
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'done'])
  })
  it('rejects unknown conversation', async () => {
    const svc = mk(new FakeAIProvider())
    await expect(svc.send({ conversationId: ids[3], text: 'x' })).rejects.toThrow(/会话/)
  })
})

describe('deleteConversation', () => {
  it('cancels, deletes rows and the Claude session', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    await svc.deleteConversation(conversation.id)
    expect(listConversations(db)).toEqual([])
    expect(ai.deleted).toEqual([conversation.id])
  })
})

describe('learning records', () => {
  const NOW_ANY = '2026-10-13T08:00:00.000Z'
  it('records a non-uncertain correction and vocabulary after a user turn, not on the opening turn', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')).toHaveLength(0)
    expect(listVocab(db, '')).toHaveLength(0)
    await svc.send({ conversationId: conversation.id, text: 'I goed to work' })
    await svc.whenIdle(conversation.id)
    const mistakes = listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]).toMatchObject({
      conversationId: conversation.id,
      original: 'I goed to work',
      improved: 'I went to work',
      category: 'grammar'
    })
    expect(listVocab(db, '')).toMatchObject([
      { word: 'commute', source: 'conversation', sourceId: conversation.id }
    ])
    expect(getPracticeSession(db, conversation.id)).toMatchObject({
      mode: 'free',
      reviewedMistakeIds: []
    })
  })
  it('skips uncertain corrections and same-conversation duplicates', async () => {
    const ai = new FakeAIProvider({
      reply: {
        reply: 'ok',
        correction: {
          original: 'x',
          improved: 'y',
          explanationZh: 'z',
          category: 'other',
          uncertain: true
        }
      }
    })
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    await svc.send({ conversationId: conversation.id, text: 'x' })
    await svc.whenIdle(conversation.id)
    expect(listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')).toHaveLength(0)
  })
  it('targeted mode selects due mistakes once at creation and puts them and the profile in the first-turn prompt', async () => {
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'He go',
        improved: 'He goes',
        explanationZh: '三单',
        category: 'grammar'
      },
      '2020-01-01T00:00:00.000Z',
      '99999999-9999-4999-8999-999999999999'
    )
    saveProfile(db, {
      level: 'B1',
      weaknesses: ['third person -s', 'articles', 'past tense', 'extra'],
      progress: [],
      suggestions: [],
      summaryZh: 's',
      updatedAt: NOW_ANY
    })
    const ai = new FakeAIProvider({ failWith: 'network' })
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'targeted' })
    await svc.whenIdle(conversation.id)
    expect(getPracticeSession(db, conversation.id)?.reviewedMistakeIds).toEqual([
      '99999999-9999-4999-8999-999999999999'
    ])
    const prompt1 = ai.calls[0].systemPrompt!
    expect(prompt1).toContain(
      'Estimated level: B1. Focus areas: third person -s; articles; past tense.'
    )
    expect(prompt1).toContain('"He go" → "He goes"')
    expect(prompt1).not.toContain('extra')
    // 首轮失败后重试：仍是同一批材料
    await svc.send({ conversationId: conversation.id, text: 'hi' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1].firstTurn).toBe(true)
    expect(ai.calls[1].systemPrompt).toContain('"He go" → "He goes"')
  })
  it('injects the profile summary into other modes too', async () => {
    saveProfile(db, {
      level: 'A2',
      weaknesses: [],
      progress: [],
      suggestions: [],
      summaryZh: 's',
      updatedAt: NOW_ANY
    })
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[0].systemPrompt).toContain('Estimated level: A2.')
  })
})
