import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/index'
import { insertLesson } from '../db/lessons'
import { getConversation, listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from './service'
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
    uuid: () => ids[n++],
    now: () => `2026-10-12T00:00:0${n}.000Z`
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
    expect(ai.calls[1]).toMatchObject({ firstTurn: false, text: 'I goed to work' })
    expect(ai.calls[1].systemPrompt).toBeUndefined()
    expect(listMessages(db, conversation.id).map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant'
    ])
    expect(getConversation(db, conversation.id)?.turnCount).toBe(1)
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
    expect(ai.calls[1]).toMatchObject({ firstTurn: true })
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
