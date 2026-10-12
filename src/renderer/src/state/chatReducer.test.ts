import { describe, it, expect } from 'vitest'
import { chatReducer, initialState, uiOf, type ChatState } from './chatReducer'
import type { Conversation, Message } from '@shared/types'

const conv = (id: string): Conversation => ({
  id,
  title: 't',
  mode: 'free',
  lessonId: null,
  scenario: null,
  turnCount: 0,
  sessionStarted: true,
  createdAt: '',
  updatedAt: '',
  endedAt: null
})
const asst = (id: string, conversationId: string): Message => ({
  id,
  conversationId,
  role: 'assistant',
  content: '',
  structured: null,
  status: 'streaming',
  fromAsr: false,
  createdAt: ''
})

function withTwoConversations(): ChatState {
  let s = chatReducer(initialState, {
    type: 'conversations/loaded',
    conversations: [conv('a'), conv('b')]
  })
  s = chatReducer(s, { type: 'conversation/selected', id: 'a' })
  s = chatReducer(s, { type: 'messages/loaded', conversationId: 'b', messages: [asst('m-b', 'b')] })
  s = chatReducer(s, { type: 'ui', conversationId: 'b', event: 'SEND' })
  return s
}

describe('chatReducer', () => {
  it('applies deltas to the right message even when another conversation is selected', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'text_delta', text: 'Hel', conversationId: 'b', messageId: 'm-b' }
    })
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'text_delta', text: 'lo', conversationId: 'b', messageId: 'm-b' }
    })
    expect(s.currentId).toBe('a')
    expect(s.messages.b[0].content).toBe('Hello')
    expect(uiOf(s, 'b')).toBe('streaming')
    expect(uiOf(s, 'a')).toBe('idle')
  })
  it('done stores structured output and uses its reply as the final text', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'text_delta', text: 'partial', conversationId: 'b', messageId: 'm-b' }
    })
    s = chatReducer(s, {
      type: 'chat/event',
      event: {
        type: 'done',
        structured: { reply: 'Full reply.' },
        rawText: 'partial',
        conversationId: 'b',
        messageId: 'm-b'
      }
    })
    expect(s.messages.b[0]).toMatchObject({
      content: 'Full reply.',
      status: 'done',
      structured: { reply: 'Full reply.' }
    })
    expect(uiOf(s, 'b')).toBe('idle')
  })
  it('done without structured keeps streamed text', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'text_delta', text: 'plain', conversationId: 'b', messageId: 'm-b' }
    })
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'done', rawText: 'plain', conversationId: 'b', messageId: 'm-b' }
    })
    expect(s.messages.b[0]).toMatchObject({ content: 'plain', status: 'done', structured: null })
  })
  it('aborted error marks stopped without an error banner; other errors mark error', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'error', kind: 'aborted', message: 'x', conversationId: 'b', messageId: 'm-b' }
    })
    expect(s.messages.b[0].status).toBe('stopped')
    expect(s.errors.b).toBeUndefined()
    expect(uiOf(s, 'b')).toBe('idle')
    let t = withTwoConversations()
    t = chatReducer(t, {
      type: 'chat/event',
      event: {
        type: 'error',
        kind: 'not_logged_in',
        message: 'login',
        conversationId: 'b',
        messageId: 'm-b'
      }
    })
    expect(t.messages.b[0].status).toBe('error')
    expect(t.errors.b).toBe('not_logged_in')
    expect(uiOf(t, 'b')).toBe('error')
  })
  it('retrying is recorded and cleared on done', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'retrying', attempt: 2, conversationId: 'b', messageId: 'm-b' }
    })
    expect(s.retrying.b).toBe(2)
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'done', rawText: '', conversationId: 'b', messageId: 'm-b' }
    })
    expect(s.retrying.b).toBeUndefined()
  })
  it('creates placeholder assistant message for unknown messageId', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'text_delta', text: 'x', conversationId: 'a', messageId: 'new' }
    })
    expect(s.messages.a?.[0]).toMatchObject({ id: 'new', role: 'assistant', content: 'x' })
  })
  it('conversation/created prepends and selects; deleted removes', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'conversation/created',
      conversation: conv('c'),
      assistantMessageId: 'm-c'
    })
    expect(s.conversations.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(s.currentId).toBe('c')
    expect(s.messages.c).toHaveLength(1)
    expect(uiOf(s, 'c')).toBe('sending')
    s = chatReducer(s, { type: 'conversation/deleted', id: 'c' })
    expect(s.conversations.map((c) => c.id)).toEqual(['a', 'b'])
    expect(s.currentId).toBe('a')
  })
  it('message/userSent appends the user message and a streaming placeholder', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'messages/loaded', conversationId: 'a', messages: [] })
    const user: Message = {
      id: 'u1',
      conversationId: 'a',
      role: 'user',
      content: 'hi',
      structured: null,
      status: 'done',
      fromAsr: false,
      createdAt: ''
    }
    s = chatReducer(s, { type: 'message/userSent', userMessage: user, assistantMessageId: 'a1' })
    expect(s.messages.a.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(uiOf(s, 'a')).toBe('sending')
  })
  it('error arriving before message/userSent keeps the conversation in error', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'messages/loaded', conversationId: 'a', messages: [] })
    s = chatReducer(s, {
      type: 'chat/event',
      event: {
        type: 'error',
        kind: 'not_logged_in',
        message: 'login',
        conversationId: 'a',
        messageId: 'a1'
      }
    })
    const user: Message = {
      id: 'u1',
      conversationId: 'a',
      role: 'user',
      content: 'hi',
      structured: null,
      status: 'done',
      fromAsr: false,
      createdAt: ''
    }
    s = chatReducer(s, { type: 'message/userSent', userMessage: user, assistantMessageId: 'a1' })
    expect(uiOf(s, 'a')).toBe('error')
    expect(s.errors.a).toBe('not_logged_in')
    expect(s.messages.a.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(s.messages.a.find((m) => m.id === 'a1')?.status).toBe('error')
  })
  it('done arriving before conversation/created leaves the new conversation idle', () => {
    let s = withTwoConversations()
    s = chatReducer(s, {
      type: 'chat/event',
      event: { type: 'done', rawText: 'hi', conversationId: 'c', messageId: 'm-c' }
    })
    s = chatReducer(s, {
      type: 'conversation/created',
      conversation: conv('c'),
      assistantMessageId: 'm-c'
    })
    expect(s.conversations.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(s.currentId).toBe('c')
    expect(uiOf(s, 'c')).toBe('idle')
    expect(s.messages.c).toHaveLength(1)
    expect(s.messages.c[0]).toMatchObject({ id: 'm-c', status: 'done' })
  })
})
