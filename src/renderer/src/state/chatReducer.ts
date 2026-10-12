import type { ChatIpcEvent, Conversation, Message } from '@shared/types'
import { transition, type UiEvent, type UiState } from './machine'

export interface ChatState {
  conversations: Conversation[]
  currentId: string | null
  messages: Record<string, Message[]>
  ui: Record<string, UiState>
  errors: Record<string, string | undefined> // 存 AIErrorKind，UI 按 kind 查文案
  retrying: Record<string, number | undefined>
}

export type ChatAction =
  | { type: 'conversations/loaded'; conversations: Conversation[] }
  | { type: 'conversation/created'; conversation: Conversation; assistantMessageId: string }
  | { type: 'conversation/selected'; id: string | null }
  | { type: 'conversation/deleted'; id: string }
  | { type: 'messages/loaded'; conversationId: string; messages: Message[] }
  | { type: 'message/userSent'; userMessage: Message; assistantMessageId: string }
  | { type: 'chat/event'; event: ChatIpcEvent }
  | { type: 'ui'; conversationId: string; event: UiEvent }
  | { type: 'error/cleared'; conversationId: string }

export const initialState: ChatState = {
  conversations: [],
  currentId: null,
  messages: {},
  ui: {},
  errors: {},
  retrying: {}
}

export const uiOf = (state: ChatState, id: string | null): UiState =>
  id ? (state.ui[id] ?? 'idle') : 'idle'

const placeholder = (id: string, conversationId: string): Message => ({
  id,
  conversationId,
  role: 'assistant',
  content: '',
  structured: null,
  status: 'streaming',
  fromAsr: false,
  createdAt: new Date().toISOString()
})

function withUi(state: ChatState, conversationId: string, event: UiEvent): ChatState {
  return {
    ...state,
    ui: { ...state.ui, [conversationId]: transition(uiOf(state, conversationId), event) }
  }
}

function patchMessage(
  state: ChatState,
  conversationId: string,
  messageId: string,
  fn: (m: Message) => Message
): ChatState {
  const list = state.messages[conversationId] ?? []
  const idx = list.findIndex((m) => m.id === messageId)
  const next =
    idx === -1
      ? [...list, fn(placeholder(messageId, conversationId))]
      : list.map((m, i) => (i === idx ? fn(m) : m))
  return { ...state, messages: { ...state.messages, [conversationId]: next } }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'conversations/loaded':
      return {
        ...state,
        conversations: action.conversations,
        currentId: state.currentId ?? action.conversations[0]?.id ?? null
      }
    case 'conversation/created': {
      const s: ChatState = {
        ...state,
        conversations: [action.conversation, ...state.conversations],
        currentId: action.conversation.id,
        messages: {
          ...state.messages,
          [action.conversation.id]: [placeholder(action.assistantMessageId, action.conversation.id)]
        }
      }
      return withUi(s, action.conversation.id, 'SEND')
    }
    case 'conversation/selected':
      return { ...state, currentId: action.id }
    case 'conversation/deleted': {
      const conversations = state.conversations.filter((c) => c.id !== action.id)
      const messages = { ...state.messages }
      delete messages[action.id]
      return {
        ...state,
        conversations,
        messages,
        currentId: state.currentId === action.id ? (conversations[0]?.id ?? null) : state.currentId
      }
    }
    case 'messages/loaded':
      return { ...state, messages: { ...state.messages, [action.conversationId]: action.messages } }
    case 'message/userSent': {
      const id = action.userMessage.conversationId
      const list = [
        ...(state.messages[id] ?? []),
        action.userMessage,
        placeholder(action.assistantMessageId, id)
      ]
      const s: ChatState = {
        ...state,
        messages: { ...state.messages, [id]: list },
        errors: { ...state.errors, [id]: undefined }
      }
      return withUi(s, id, 'SEND')
    }
    case 'ui':
      return withUi(state, action.conversationId, action.event)
    case 'error/cleared':
      return withUi(
        { ...state, errors: { ...state.errors, [action.conversationId]: undefined } },
        action.conversationId,
        'RESET'
      )
    case 'chat/event': {
      const ev = action.event
      const cid = ev.conversationId
      switch (ev.type) {
        case 'text_delta':
          return withUi(
            patchMessage(state, cid, ev.messageId, (m) => ({ ...m, content: m.content + ev.text })),
            cid,
            'FIRST_DELTA'
          )
        case 'retrying':
          return { ...state, retrying: { ...state.retrying, [cid]: ev.attempt } }
        case 'done': {
          const s = patchMessage(state, cid, ev.messageId, (m) => ({
            ...m,
            content: ev.structured?.reply ?? (m.content || ev.rawText),
            structured: ev.structured ?? null,
            status: 'done'
          }))
          return withUi({ ...s, retrying: { ...s.retrying, [cid]: undefined } }, cid, 'DONE')
        }
        case 'error': {
          const aborted = ev.kind === 'aborted'
          const s = patchMessage(state, cid, ev.messageId, (m) => ({
            ...m,
            status: aborted ? 'stopped' : 'error'
          }))
          const t: ChatState = {
            ...s,
            retrying: { ...s.retrying, [cid]: undefined },
            errors: { ...s.errors, [cid]: aborted ? undefined : ev.kind }
          }
          return withUi(t, cid, aborted ? 'STOP' : 'FAIL')
        }
      }
    }
  }
  return state
}
