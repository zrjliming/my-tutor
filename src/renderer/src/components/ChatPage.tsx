import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { MODE_LABEL, type AIErrorKind } from '@shared/types'
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
                <button className="underline" onClick={chat.clearError}>
                  知道了
                </button>
              </div>
            )}
            <MessageList messages={chat.currentMessages} />
            <InputBar
              ui={chat.ui}
              onSend={(t) => chat.sendMessage(t)}
              onStop={() => void chat.cancel()}
              onPickImage={() => onOpenLessonDialog()}
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
