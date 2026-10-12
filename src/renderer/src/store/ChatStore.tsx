import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode
} from 'react'
import type {
  AppSettings,
  Conversation,
  CreateConversationInput,
  Message,
  SettingsPatch
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'
import { chatReducer, initialState, uiOf, type ChatState } from '../state/chatReducer'
import type { UiEvent, UiState } from '../state/machine'

export interface ChatContextValue {
  state: ChatState
  settings: AppSettings
  current: Conversation | null
  currentMessages: Message[]
  ui: UiState
  select(id: string): Promise<void>
  createConversation(input: CreateConversationInput): Promise<Conversation>
  sendMessage(text: string, fromAsr?: boolean): Promise<void>
  cancel(): Promise<void>
  deleteConversation(id: string): Promise<void>
  dispatchUi(event: UiEvent): void
  clearError(): void
  patchSettings(patch: SettingsPatch): Promise<void>
}

const Ctx = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void api.conversations
      .list()
      .then((conversations) => dispatch({ type: 'conversations/loaded', conversations }))
    void api.settings.get().then(setSettings)
    return api.chat.onEvent((event) => dispatch({ type: 'chat/event', event }))
  }, [])

  const currentId = state.currentId
  useEffect(() => {
    if (currentId && !state.messages[currentId]) {
      void api.messages
        .list(currentId)
        .then((messages) =>
          dispatch({ type: 'messages/loaded', conversationId: currentId, messages })
        )
    }
  }, [currentId, state.messages])

  const select = useCallback(
    async (id: string) => dispatch({ type: 'conversation/selected', id }),
    []
  )

  const createConversation = useCallback(async (input: CreateConversationInput) => {
    const { conversation, assistantMessageId } = await api.conversations.create(input)
    dispatch({ type: 'conversation/created', conversation, assistantMessageId })
    return conversation
  }, [])

  const sendMessage = useCallback(
    async (text: string, fromAsr = false) => {
      if (!currentId) return
      const { userMessage, assistantMessageId } = await api.chat.send({
        conversationId: currentId,
        text,
        fromAsr
      })
      dispatch({ type: 'message/userSent', userMessage, assistantMessageId })
    },
    [currentId]
  )

  const cancel = useCallback(async () => {
    if (currentId) await api.chat.cancel(currentId)
  }, [currentId])

  const deleteConversation = useCallback(async (id: string) => {
    await api.conversations.delete(id)
    dispatch({ type: 'conversation/deleted', id })
  }, [])

  const dispatchUi = useCallback(
    (event: UiEvent) => {
      if (currentId) dispatch({ type: 'ui', conversationId: currentId, event })
    },
    [currentId]
  )

  const clearError = useCallback(() => {
    if (currentId) dispatch({ type: 'error/cleared', conversationId: currentId })
  }, [currentId])

  const patchSettings = useCallback(
    async (patch: SettingsPatch) => setSettings(await api.settings.patch(patch)),
    []
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      settings,
      current: state.conversations.find((c) => c.id === currentId) ?? null,
      currentMessages: currentId ? (state.messages[currentId] ?? []) : [],
      ui: uiOf(state, currentId),
      select,
      createConversation,
      sendMessage,
      cancel,
      deleteConversation,
      dispatchUi,
      clearError,
      patchSettings
    }),
    [
      state,
      settings,
      currentId,
      select,
      createConversation,
      sendMessage,
      cancel,
      deleteConversation,
      dispatchUi,
      clearError,
      patchSettings
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChat(): ChatContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be used inside ChatProvider')
  return v
}
