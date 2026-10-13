import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent
} from 'react'
import { MODE_LABEL, type AIErrorKind } from '@shared/types'
import { api } from '../api'
import { useRecorder } from '../hooks/useRecorder'
import { encodeWav16, isSilent } from '../lib/wav'
import { canSpeak } from '../state/machine'
import { useChat } from '../store/ChatStore'
import { ConversationList } from './ConversationList'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { StatePill } from './StatePill'

const ERROR_TEXT: Record<Exclude<AIErrorKind, 'aborted'>, string> = {
  not_logged_in: 'Claude Code 未登录或不可用，去设置页点"检测连接"。',
  binary_missing: '找不到 Claude 二进制，请重新安装依赖。',
  rate_limited: '请求被限流，稍后再试。',
  network: '网络异常，稍后再试。',
  unknown: '请求失败，请稍后再试。'
}

export function ChatPage({
  onOpenLessonDialog,
  onNew
}: {
  onOpenLessonDialog: (files?: File[]) => void
  onNew: () => void
}): React.JSX.Element {
  const chat = useChat()
  const [text, setText] = useState('')
  const [micDenied, setMicDenied] = useState(false)
  const [voiceReady, setVoiceReady] = useState<{ ok: boolean; reason: string }>({
    ok: false,
    reason: '检查语音识别状态…'
  })
  const onMicRef = useRef<() => Promise<void>>(async () => {})
  const recorder = useRecorder({
    onError: (m) => chat.showError(m),
    // 到 60 秒上限或麦克风断开时，走与点 ■ 完全相同的流程，录音不会丢
    onAutoStop: () => void onMicRef.current()
  })

  useEffect(() => {
    void api.voice.status().then((s) => {
      if (!s.binaryFound)
        setVoiceReady({ ok: false, reason: '语音识别未就绪：找不到 whisper-cli，去设置页检查' })
      else if (!s.modelFound)
        setVoiceReady({ ok: false, reason: '语音识别未就绪：模型未下载，去设置页下载' })
      else setVoiceReady({ ok: true, reason: '开始录音' })
    })
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
        chat.showError('没听到声音，请靠近麦克风再试。')
        return
      }
      const result = await chat.transcribe(encodeWav16(samples, 16000))
      // 识别期间切换了会话，文字不能落到新会话的输入框
      if (result !== null && currentIdRef.current === cid) setText(result)
      return
    }
    // 开始录音前先停朗读，免得把朗读声录进去
    void chat.stopSpeaking()
    const allowed = await api.voice.requestMic()
    if (!allowed) {
      chat.showError('麦克风权限被拒绝。请在“系统设置 → 隐私与安全性 → 麦克风”里允许 my-tutor。')
      setMicDenied(true)
      return
    }
    setMicDenied(false)
    try {
      await recorder.start()
      if (!cid || currentIdRef.current !== cid) {
        // 启动期间切换了会话：丢掉这次录音
        recorder.cancel()
        return
      }
      chat.dispatchUiFor(cid, 'START_RECORDING')
    } catch (e) {
      chat.showError(`无法开始录音：${String((e as Error)?.message ?? e)}`)
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
  const err = chat.current ? chat.state.errors[chat.current.id] : undefined
  const retrying = chat.current ? chat.state.retrying[chat.current.id] : undefined

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDrag(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) onOpenLessonDialog(files)
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
            松开，识别为学习内容
          </div>
        )}
        {chat.current ? (
          <>
            <div className="flex items-center gap-2.5 px-4 pt-10 pb-2.5 border-b border-line">
              <h2 className="text-sm font-semibold flex-1 truncate">{chat.current.title}</h2>
              <span className="text-[11px] px-1.5 rounded-full bg-accent-soft text-accent">
                {MODE_LABEL[chat.current.mode]}
                {chat.current.scenario ? ` · ${chat.current.scenario}` : ''}
              </span>
              <StatePill state={chat.ui} />
              {chat.ui === 'speaking' && (
                <button
                  className="text-xs px-2 py-0.5 rounded-md border border-line"
                  onClick={() => void chat.stopSpeaking()}
                >
                  停止朗读
                </button>
              )}
              <button
                className="text-xs px-2 py-0.5 rounded-md border border-line text-bad"
                onClick={() => void onDelete()}
              >
                {confirmId === chat.current.id ? '确认删除？' : '删除'}
              </button>
            </div>
            {retrying !== undefined && (
              <div className="px-4 py-1 text-xs text-warn bg-warn-soft">
                Claude 请求重试中（第 {retrying} 次）…
              </div>
            )}
            {err && (
              <div className="px-4 py-1.5 text-xs text-bad bg-bad-soft flex items-center gap-2">
                <span className="flex-1">
                  {ERROR_TEXT[err as Exclude<AIErrorKind, 'aborted'>] ?? err}
                </span>
                {micDenied && (
                  <button className="underline" onClick={() => void api.voice.openMicSettings()}>
                    打开系统设置
                  </button>
                )}
                <button className="underline" onClick={chat.clearError}>
                  知道了
                </button>
              </div>
            )}
            <MessageList
              messages={chat.currentMessages}
              onSpeak={(t) => void chat.speak(t)}
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
              onSend={(t) => chat.sendMessage(t, chat.asrDraft !== null)}
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
            新建一个会话开始练习
          </div>
        )}
      </div>
    </>
  )
}
