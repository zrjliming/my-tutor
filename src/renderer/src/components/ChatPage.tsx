import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent
} from 'react'
import type { AIErrorKind } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'
import { useRecorder } from '../hooks/useRecorder'
import { classifyFiles, readTextFiles } from '../lib/dropFiles'
import { isRecordingCancelled } from '../lib/recorder'
import { encodeWav16, isSilent } from '../lib/wav'
import { canSpeak } from '../state/machine'
import { useChat } from '../store/ChatStore'
import { ConversationList } from './ConversationList'
import { conversationTitle } from '../lib/conversationTitle'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { StatePill } from './StatePill'

const ERROR_KEY: Record<Exclude<AIErrorKind, 'aborted'>, string> = {
  not_logged_in: 'chat.error.notLoggedIn',
  binary_missing: 'chat.error.binaryMissing',
  rate_limited: 'chat.error.rateLimited',
  network: 'chat.error.network',
  unknown: 'chat.error.unknown'
}

async function voiceReadiness(): Promise<{ ok: boolean; reason: string }> {
  const s = await api.voice.status().catch(() => null)
  if (!s) return { ok: false, reason: t('chat.voice.statusFailed') }
  if (!s.binaryFound) return { ok: false, reason: t('chat.voice.binaryMissing') }
  if (!s.modelFound) return { ok: false, reason: t('chat.voice.modelMissing') }
  return { ok: true, reason: t('chat.voice.startRecording') }
}

export function ChatPage({
  onOpenLessonDialog,
  onNew
}: {
  onOpenLessonDialog: (files?: File[], text?: string) => void
  onNew: () => void
}): React.JSX.Element {
  const chat = useChat()
  const [text, setText] = useState('')
  const [micDenied, setMicDenied] = useState(false)
  const [voiceReady, setVoiceReady] = useState<{ ok: boolean; reason: string }>({
    ok: false,
    reason: t('chat.voice.checking')
  })
  const onMicRef = useRef<() => Promise<void>>(async () => {})
  // 页面卸载后（如切到设置页），还在进行的启动录音不能再 dispatch 或弹横幅
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const recorder = useRecorder({
    onError: (m) => chat.showError(m),
    // 到 60 秒上限或麦克风断开时，走与点 ■ 完全相同的流程，录音不会丢
    onAutoStop: () => {
      if (!mountedRef.current) return
      void onMicRef.current()
    }
  })

  // 挂载时查一次；每次开始录音前再查一次（模型/二进制可能在聊天页停留期间失效）
  useEffect(() => {
    void voiceReadiness().then(setVoiceReady)
  }, [])

  // 切换会话时清空输入（渲染期按会话 id 重置 state）与录音（recorder.cancel 是稳定的 useCallback）
  const currentIdForEffect = chat.current?.id ?? null
  const [textOwnerId, setTextOwnerId] = useState(currentIdForEffect)
  if (textOwnerId !== currentIdForEffect) {
    setTextOwnerId(currentIdForEffect)
    setText('')
  }
  // 规则：ASR 标记和 awaiting_confirmation 只在它描述的文字还在输入框里时存在。
  // 输入框文字是本组件的 state，切换会话或页面卸载就没了，所以：
  // - 进入会话（切换进来或挂载）时清掉该会话的草稿；
  // - 离开会话（切换走或卸载）时取消它的录音/识别并清掉草稿。
  // 副作用（停录音、dispatch 到 store）不能放在渲染期，所以放在 effect 里；渲染期的重置只管 text。
  const currentIdRef = useRef(currentIdForEffect)
  const uiMapRef = useRef(chat.state.ui)
  const micBusyRef = useRef(false)
  const cancelRecording = recorder.cancel
  const dispatchUiFor = chat.dispatchUiFor
  const clearAsrDraftFor = chat.clearAsrDraftFor
  useEffect(() => {
    const id = currentIdForEffect
    if (!id) return
    const clearDraft = (): void => {
      clearAsrDraftFor(id)
      dispatchUiFor(id, 'INPUT_CLEARED')
    }
    clearDraft()
    return () => {
      const ui = uiMapRef.current[id]
      cancelRecording()
      if (ui === 'recording') dispatchUiFor(id, 'STOP')
      // store 的 transcribe 会把 aborted 映射成该会话的 STOP，且不弹横幅
      else if (ui === 'transcribing') void api.voice.cancelTranscribe()
      clearDraft()
      // 切换会话或离开聊天页都算"离开"：通知主进程结束本次练习（幂等）
      void api.conversations.end(id)
    }
  }, [currentIdForEffect, cancelRecording, dispatchUiFor, clearAsrDraftFor])

  const onMic = async (): Promise<void> => {
    // 60 秒自动停止可能和用户点 ■ 撞在一起：只处理第一次
    if (micBusyRef.current) return
    micBusyRef.current = true
    try {
      await handleMic()
    } finally {
      micBusyRef.current = false
    }
  }

  const handleMic = async (): Promise<void> => {
    const cid = currentIdForEffect
    if (chat.ui === 'recording') {
      const samples = await recorder.stop()
      if (isSilent(samples)) {
        chat.dispatchUi('STOP')
        chat.showError(t('chat.voice.silent'))
        return
      }
      const result = await chat.transcribe(encodeWav16(samples, 16000))
      // 识别期间切换了会话，文字不能落到新会话的输入框
      if (result !== null && currentIdRef.current === cid) setText(result)
      return
    }
    const ready = await voiceReadiness()
    if (!mountedRef.current) return
    setVoiceReady(ready)
    if (!ready.ok) {
      chat.showError(ready.reason)
      return
    }
    // 开始录音前先停朗读，免得把朗读声录进去
    void chat.stopSpeaking()
    const allowed = await api.voice.requestMic()
    if (!mountedRef.current) return
    if (!allowed) {
      chat.showError(t('chat.voice.micDenied'))
      setMicDenied(true)
      return
    }
    setMicDenied(false)
    try {
      await recorder.start()
      if (!mountedRef.current) return
      if (!cid || currentIdRef.current !== cid) {
        // 启动期间切换了会话：丢掉这次录音
        recorder.cancel()
        return
      }
      // 重新录音：清掉旧横幅、旧的识别标记和输入框里的旧文字
      chat.clearError()
      chat.clearAsrDraft()
      setText('')
      chat.dispatchUiFor(cid, 'START_RECORDING')
    } catch (e) {
      if (!mountedRef.current || isRecordingCancelled(e)) return
      chat.showError(t('chat.voice.startFailed', { message: String((e as Error)?.message ?? e) }))
    }
  }
  useLayoutEffect(() => {
    onMicRef.current = onMic
    currentIdRef.current = currentIdForEffect
    uiMapRef.current = chat.state.ui
  })

  const onStop = (): void => {
    if (chat.ui === 'transcribing') void chat.cancelTranscribe()
    else void chat.cancel()
  }
  // 确认状态绑定到具体会话，切换会话后不会误删另一个
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resetConfirm = (): void => {
    clearTimeout(confirmTimer.current)
    setConfirmId(null)
  }
  useEffect(() => () => clearTimeout(confirmTimer.current), [])
  const [drag, setDrag] = useState(false)
  // 没有当前会话时错误横幅不显示，不支持的文件提示退到空态文案里
  const [dropNote, setDropNote] = useState<string | null>(null)
  const err = chat.current ? chat.state.errors[chat.current.id] : undefined
  const retrying = chat.current ? chat.state.retrying[chat.current.id] : undefined

  // 窗口重新获得焦点/变为可见时重查语音状态：模型在别处恢复后麦克风能自动解禁，并清掉旧的"未就绪"横幅
  const readinessBannerRef = useRef({ err, clearError: chat.clearError })
  useLayoutEffect(() => {
    readinessBannerRef.current = { err, clearError: chat.clearError }
  })
  useEffect(() => {
    const recheck = (): void => {
      if (document.visibilityState === 'hidden') return
      void voiceReadiness().then((ready) => {
        if (!mountedRef.current) return
        setVoiceReady(ready)
        const banner = readinessBannerRef.current
        if (ready.ok && banner.err?.startsWith(t('chat.voice.notReady'))) banner.clearError()
      })
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [])

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDrag(false)
    setDropNote(null)
    const { images, texts, other } = classifyFiles(e.dataTransfer.files)
    if (images.length || texts.length) {
      if (!texts.length) onOpenLessonDialog(images)
      else
        void readTextFiles(texts).then(
          (text) => onOpenLessonDialog(images, text),
          (err) => chat.showError(String((err as Error)?.message ?? err))
        )
    } else if (other.length) {
      if (chat.current) chat.showError(t('chat.dropUnsupported'))
      else setDropNote(t('chat.dropUnsupported'))
    }
  }
  const onPaste = (e: ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      onOpenLessonDialog(files)
    }
  }
  const onDelete = async (): Promise<void> => {
    if (!chat.current) return
    const id = chat.current.id
    if (confirmId !== id) {
      clearTimeout(confirmTimer.current)
      setConfirmId(id)
      confirmTimer.current = setTimeout(() => setConfirmId(null), 2500)
      return
    }
    resetConfirm()
    await chat.deleteConversation(id)
  }

  return (
    <>
      <ConversationList
        conversations={chat.state.conversations}
        currentId={chat.current?.id ?? null}
        onSelect={(id) => {
          resetConfirm()
          void chat.select(id)
        }}
        onNew={onNew}
      />
      <div
        className="flex-1 min-w-0 flex flex-col relative"
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false)
        }}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {drag && (
          <div className="absolute inset-0 z-10 bg-accent-soft border-2 border-dashed border-accent flex items-center justify-center text-accent text-base">
            {t('chat.dropHint')}
          </div>
        )}
        {chat.current ? (
          <>
            <div className="flex items-center gap-2.5 px-4 pt-10 pb-2.5 border-b border-line">
              <h2 className="text-sm font-semibold flex-1 truncate">
                {conversationTitle(chat.current)}
              </h2>
              <span className="text-[11px] px-1.5 rounded-full bg-accent-soft text-accent">
                {t(`chat.mode.${chat.current.mode}`)}
                {chat.current.scenario ? ` · ${chat.current.scenario}` : ''}
              </span>
              <StatePill state={chat.ui} />
              {chat.ui === 'speaking' && (
                <button
                  className="text-xs px-2 py-0.5 rounded-md border border-line"
                  onClick={() => void chat.stopSpeaking()}
                >
                  {t('chat.stopSpeaking')}
                </button>
              )}
              <button
                className="text-xs px-2 py-0.5 rounded-md border border-line text-bad"
                onClick={() => void onDelete()}
              >
                {confirmId === chat.current.id ? t('chat.confirmDelete') : t('chat.delete')}
              </button>
            </div>
            {retrying !== undefined && (
              <div className="px-4 py-1 text-xs text-warn bg-warn-soft">
                {t('chat.retrying', { n: retrying })}
              </div>
            )}
            {err && (
              <div className="px-4 py-1.5 text-xs text-bad bg-bad-soft flex items-center gap-2">
                <span className="flex-1">
                  {err in ERROR_KEY ? t(ERROR_KEY[err as Exclude<AIErrorKind, 'aborted'>]) : err}
                </span>
                {micDenied && (
                  <button className="underline" onClick={() => void api.voice.openMicSettings()}>
                    {t('chat.openSystemSettings')}
                  </button>
                )}
                <button className="underline" onClick={chat.clearError}>
                  {t('chat.dismiss')}
                </button>
              </div>
            )}
            <MessageList
              messages={chat.currentMessages}
              onSpeak={(s) => void chat.speak(s)}
              canSpeak={canSpeak(chat.ui)}
            />
            <InputBar
              ui={chat.ui}
              value={text}
              onChange={(v) => {
                setText(v)
                // 在这里判断新值：onClearAsr 闭包里的 text 还是改之前的旧值
                if (!v) chat.dispatchUi('INPUT_CLEARED')
              }}
              onSend={(s) => chat.sendMessage(s, chat.asrDraft !== null)}
              onStop={onStop}
              onPickImage={() => onOpenLessonDialog()}
              onMic={() => void onMic()}
              micDisabled={!voiceReady.ok}
              micTitle={voiceReady.reason}
              recordingSeconds={chat.ui === 'recording' ? recorder.seconds : null}
              asr={chat.asrDraft}
              onClearAsr={chat.clearAsrDraft}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-fg-3">
            {dropNote ?? t('chat.emptyHint')}
          </div>
        )}
      </div>
    </>
  )
}
