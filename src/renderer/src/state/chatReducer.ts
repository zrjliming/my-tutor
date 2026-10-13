import type { ChatIpcEvent, Conversation, Message } from '@shared/types'
import { transition, type UiEvent, type UiState } from './machine'

export interface ChatState {
  conversations: Conversation[]
  currentId: string | null
  messages: Record<string, Message[]>
  ui: Record<string, UiState>
  errors: Record<string, string | undefined> // 存 AIErrorKind（UI 按 kind 查文案）或直接展示的中文提示
  retrying: Record<string, number | undefined>
  asrDraft: Record<string, { confidence: number } | undefined>
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
  | { type: 'error/shown'; conversationId: string; message: string }
  | { type: 'asr/transcribed'; conversationId: string; confidence: number }
  | { type: 'asr/cleared'; conversationId: string }

export const initialState: ChatState = {
  conversations: [],
  currentId: null,
  messages: {},
  ui: {},
  errors: {},
  retrying: {},
  asrDraft: {}
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

// 流事件可能先于 send/create 的 IPC 回复到达：助手消息已存在时按其终态补齐状态转移
const TERMINAL: Partial<Record<Message['status'], UiEvent>> = {
  done: 'DONE',
  error: 'FAIL',
  stopped: 'STOP'
}

function sendFor(state: ChatState, conversationId: string, existing?: Message): ChatState {
  const s = withUi(state, conversationId, 'SEND')
  const terminal = existing && TERMINAL[existing.status]
  return terminal ? withUi(s, conversationId, terminal) : s
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
      const cid = action.conversation.id
      const prev = state.messages[cid] ?? []
      const existing = prev.find((m) => m.id === action.assistantMessageId)
      const s: ChatState = {
        ...state,
        conversations: [action.conversation, ...state.conversations],
        currentId: cid,
        messages: {
          ...state.messages,
          [cid]: existing ? prev : [...prev, placeholder(action.assistantMessageId, cid)]
        }
      }
      return sendFor(s, cid, existing)
    }
    case 'conversation/selected':
      return { ...state, currentId: action.id }
    case 'conversation/deleted': {
      const conversations = state.conversations.filter((c) => c.id !== action.id)
      const messages = { ...state.messages }
      delete messages[action.id]
      const asrDraft = { ...state.asrDraft }
      delete asrDraft[action.id]
      return {
        ...state,
        conversations,
        messages,
        asrDraft,
        currentId: state.currentId === action.id ? (conversations[0]?.id ?? null) : state.currentId
      }
    }
    case 'messages/loaded':
      return { ...state, messages: { ...state.messages, [action.conversationId]: action.messages } }
    case 'message/userSent': {
      const id = action.userMessage.conversationId
      const prev = state.messages[id] ?? []
      const idx = prev.findIndex((m) => m.id === action.assistantMessageId)
      const existing = idx === -1 ? undefined : prev[idx]
      // 已存在的助手消息保持原位，用户消息插在它前面，保证显示顺序
      const list = existing
        ? [...prev.slice(0, idx), action.userMessage, ...prev.slice(idx)]
        : [...prev, action.userMessage, placeholder(action.assistantMessageId, id)]
      const s: ChatState = {
        ...state,
        messages: { ...state.messages, [id]: list },
        errors: existing?.status === 'error' ? state.errors : { ...state.errors, [id]: undefined },
        asrDraft: { ...state.asrDraft, [id]: undefined }
      }
      return sendFor(s, id, existing)
    }
    case 'ui':
      return withUi(state, action.conversationId, action.event)
    case 'error/shown':
      return { ...state, errors: { ...state.errors, [action.conversationId]: action.message } }
    case 'asr/transcribed':
      // 识别成功：之前的错误横幅（录音中断、识别失败等）已过时
      return {
        ...state,
        errors: { ...state.errors, [action.conversationId]: undefined },
        asrDraft: { ...state.asrDraft, [action.conversationId]: { confidence: action.confidence } }
      }
    case 'asr/cleared':
      return { ...state, asrDraft: { ...state.asrDraft, [action.conversationId]: undefined } }
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
