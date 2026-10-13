import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppSettings,
  Conversation,
  CreateConversationInput,
  Message,
  SettingsPatch,
  SpeakOutcome
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'
import { chatReducer, initialState, uiOf, type ChatState } from '../state/chatReducer'
import { canSpeak, type UiEvent, type UiState } from '../state/machine'

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
  clearAsrDraftFor(conversationId: string): void
  showError(message: string): void
  patchSettings(patch: SettingsPatch): Promise<void>
  speak(text: string): Promise<void>
  stopSpeaking(): Promise<void>
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
  const currentId = state.currentId

  // 每个会话最近一次朗读的序号：被同一会话的新朗读顶替的旧朗读结束时不发 SPEAK_END，
  // 否则新朗读还在播放时状态就回到 idle 了
  const speakSeq = useRef(0)
  const latestSpeak = useRef<Record<string, number>>({})
  const speakFor = useCallback(async (cid: string, text: string) => {
    const seq = ++speakSeq.current
    latestSpeak.current[cid] = seq
    dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK' })
    let outcome: SpeakOutcome
    try {
      outcome = await api.voice.speak(text)
    } catch (e) {
      outcome = { ok: false, kind: 'failed', message: String((e as Error)?.message ?? e) }
    }
    // 被同一会话的新朗读顶替时，SPEAK_END 和失败横幅都交给新的那次
    if (latestSpeak.current[cid] !== seq) return
    dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK_END' })
    if (!outcome.ok)
      dispatch({
        type: 'error/shown',
        conversationId: cid,
        message: `朗读失败：${outcome.message}`
      })
  }, [])

  // 事件订阅只在挂载时建立一次，通过 ref 读取最新的设置与当前会话
  const settingsRef = useRef(settings)
  const currentIdRef = useRef(currentId)
  useLayoutEffect(() => {
    settingsRef.current = settings
    currentIdRef.current = currentId
  })

  useEffect(() => {
    void api.conversations
      .list()
      .then((conversations) => dispatch({ type: 'conversations/loaded', conversations }))
    void api.settings.get().then(setSettings)
    return api.chat.onEvent((event) => {
      dispatch({ type: 'chat/event', event })
      // 只自动朗读当前会话的回复，且只读英文 reply，不读中文解释
      if (
        event.type === 'done' &&
        settingsRef.current.autoSpeak &&
        event.conversationId === currentIdRef.current
      ) {
        const text = event.structured?.reply ?? event.rawText
        if (text.trim()) void speakFor(event.conversationId, text)
      }
    })
  }, [speakFor])

  useEffect(() => {
    if (currentId && !state.messages[currentId]) {
      void api.messages
        .list(currentId)
        .then((messages) =>
          dispatch({ type: 'messages/loaded', conversationId: currentId, messages })
        )
    }
  }, [currentId, state.messages])

  const select = useCallback(async (id: string) => {
    void api.voice.stopSpeaking()
    dispatch({ type: 'conversation/selected', id })
  }, [])

  const createConversation = useCallback(async (input: CreateConversationInput) => {
    const { conversation, assistantMessageId } = await api.conversations.create(input)
    dispatch({ type: 'conversation/created', conversation, assistantMessageId })
    return conversation
  }, [])

  const sendMessage = useCallback(
    async (text: string, fromAsr = false) => {
      if (!currentId) return
      void api.voice.stopSpeaking()
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

  const clearAsrDraftFor = useCallback(
    (conversationId: string) => dispatch({ type: 'asr/cleared', conversationId }),
    []
  )

  const clearAsrDraft = useCallback(() => {
    if (currentId) dispatch({ type: 'asr/cleared', conversationId: currentId })
  }, [currentId])

  const patchSettings = useCallback(
    async (patch: SettingsPatch) => setSettings(await api.settings.patch(patch)),
    []
  )

  const speak = useCallback(
    async (text: string) => {
      // 发送/流式/出错时状态机不接受 SPEAK，此时朗读会没有 speaking 状态和停止按钮
      if (!currentId || !text.trim() || !canSpeak(uiOf(state, currentId))) return
      await speakFor(currentId, text)
    },
    [currentId, speakFor, state]
  )

  const stopSpeaking = useCallback(async () => api.voice.stopSpeaking(), [])

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
      clearAsrDraftFor,
      showError,
      patchSettings,
      speak,
      stopSpeaking
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
      clearAsrDraftFor,
      showError,
      patchSettings,
      speak,
      stopSpeaking
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChat(): ChatContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be used inside ChatProvider')
  return v
}
