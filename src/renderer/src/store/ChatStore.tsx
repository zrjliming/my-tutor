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
  dispatchUiFor(conversationId: string, event: UiEvent): void
  clearError(): void
  asrDraft: { confidence: number } | null
  transcribe(wav: Uint8Array): Promise<string | null>
  cancelTranscribe(): Promise<void>
  clearAsrDraft(): void
  showError(message: string): void
  patchSettings(patch: SettingsPatch): Promise<void>
}

const ASR_TEXT: Record<string, string> = {
  binary_missing: '语音识别未就绪：找不到 whisper-cli，去设置页检查。',
  model_missing: '语音识别未就绪：模型未下载，去设置页下载。',
  empty: '没识别出内容，再试一次。',
  timeout: '识别超时，请缩短录音再试。',
  failed: '识别失败'
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
      try {
        const { userMessage, assistantMessageId } = await api.chat.send({
          conversationId: currentId,
          text,
          fromAsr
        })
        dispatch({ type: 'message/userSent', userMessage, assistantMessageId })
      } catch (e) {
        const raw = String((e as Error)?.message ?? e)
        // 去掉 Electron 包装的 "Error invoking remote method 'x': Error: " 前缀
        const message = raw.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')
        dispatch({
          type: 'error/shown',
          conversationId: currentId,
          message: `发送失败：${message}`
        })
        throw e
      }
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

  const dispatchUiFor = useCallback(
    (conversationId: string, event: UiEvent) => dispatch({ type: 'ui', conversationId, event }),
    []
  )

  const clearError = useCallback(() => {
    if (currentId) dispatch({ type: 'error/cleared', conversationId: currentId })
  }, [currentId])

  const showError = useCallback(
    (message: string) => {
      if (currentId) dispatch({ type: 'error/shown', conversationId: currentId, message })
    },
    [currentId]
  )

  const transcribe = useCallback(
    async (wav: Uint8Array): Promise<string | null> => {
      if (!currentId) return null
      const cid = currentId
      dispatch({ type: 'ui', conversationId: cid, event: 'STOP_RECORDING' })
      const outcome = await api.voice.transcribe(wav)
      if (outcome.ok) {
        dispatch({
          type: 'asr/transcribed',
          conversationId: cid,
          confidence: outcome.result.confidence
        })
        dispatch({ type: 'ui', conversationId: cid, event: 'TRANSCRIBED' })
        return outcome.result.text
      }
      dispatch({ type: 'ui', conversationId: cid, event: 'STOP' })
      if (outcome.kind !== 'aborted') {
        const base = ASR_TEXT[outcome.kind] ?? '识别失败'
        dispatch({
          type: 'error/shown',
          conversationId: cid,
          message: outcome.kind === 'failed' ? `${base}：${outcome.message}` : base
        })
      }
      return null
    },
    [currentId]
  )

  const cancelTranscribe = useCallback(async () => api.voice.cancelTranscribe(), [])

  const clearAsrDraft = useCallback(() => {
    if (currentId) dispatch({ type: 'asr/cleared', conversationId: currentId })
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
      dispatchUiFor,
      clearError,
      asrDraft: currentId ? (state.asrDraft[currentId] ?? null) : null,
      transcribe,
      cancelTranscribe,
      clearAsrDraft,
      showError,
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
      dispatchUiFor,
      clearError,
      transcribe,
      cancelTranscribe,
      clearAsrDraft,
      showError,
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
