import { useState, type KeyboardEvent } from 'react'
import { canSend, isBusy, type UiState } from '../state/machine'

interface Props {
  ui: UiState
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onPickImage: () => void
}

export function InputBar({ ui, onSend, onStop, onPickImage }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const busy = isBusy(ui)
  const submit = (): void => {
    const t = text.trim()
    if (!t || !canSend(ui) || sending) return
    setSending(true)
    // 成功后才清空；失败时保留文字（错误提示由 store 显示）
    onSend(t)
      .then(() => setText(''))
      .catch(() => {})
      .finally(() => setSending(false))
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const btn =
    'w-9 h-9 rounded-lg inline-flex items-center justify-center border border-line disabled:opacity-40'
  const plain = `${btn} bg-surface text-fg-2`
  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5 flex items-end gap-2">
      <button
        className={plain}
        title="选择图片，识别为学习内容"
        onClick={onPickImage}
        disabled={busy}
      >
        🖼
      </button>
      <textarea
        id="chat-input"
        className="flex-1 min-w-0 resize-none h-10 max-h-30 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-2 focus:outline-accent"
        placeholder="输入英文，回车发送…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        maxLength={4000}
        disabled={ui === 'recording' || ui === 'transcribing'}
      />
      <button className={plain} title="语音输入在阶段 2 提供" disabled>
        🎤
      </button>
      {busy ? (
        <button className={`${btn} bg-bad-soft text-bad`} title="停止生成" onClick={onStop}>
          ■
        </button>
      ) : (
        <button
          className={`${btn} bg-accent text-white border-transparent`}
          title="发送"
          onClick={submit}
          disabled={!canSend(ui) || !text.trim() || sending}
        >
          ➤
        </button>
      )}
    </div>
  )
}
