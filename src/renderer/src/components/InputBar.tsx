import { useState, type KeyboardEvent } from 'react'
import { ASR_LOW_CONFIDENCE, MAX_RECORDING_SECONDS } from '@shared/types'
import { canRecord, canSend, isBusy, type UiState } from '../state/machine'

interface Props {
  ui: UiState
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onPickImage: () => void
  onMic: () => void
  micDisabled: boolean
  micTitle: string
  recordingSeconds: number | null
  asr: { confidence: number } | null
  onClearAsr: () => void
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function InputBar(p: Props): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const busy = isBusy(p.ui)
  const recording = p.ui === 'recording'
  const transcribing = p.ui === 'transcribing'
  const submit = (): void => {
    const t = p.value.trim()
    if (!t || !canSend(p.ui) || sending) return
    setSending(true)
    // 成功后才清空；失败时保留文字（错误提示由 store 显示）
    p.onSend(t)
      .then(() => p.onChange(''))
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
  const low = p.asr !== null && p.asr.confidence < ASR_LOW_CONFIDENCE
  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5 flex flex-col gap-2">
      {p.asr && (
        <span
          className={`self-start inline-flex items-center gap-1.5 text-[11.5px] px-2 py-0.5 rounded ${low ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'}`}
        >
          🎙 来自语音识别{low ? ' · 识别不确定，请检查' : ''}
          <button className="ml-1" title="清除标记" onClick={p.onClearAsr}>
            ✕
          </button>
        </span>
      )}
      <div className="flex items-end gap-2">
        <button
          className={plain}
          title="选择图片，识别为学习内容"
          onClick={p.onPickImage}
          disabled={busy || recording || transcribing}
        >
          🖼
        </button>
        <textarea
          id="chat-input"
          className="flex-1 min-w-0 resize-none h-10 max-h-30 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-2 focus:outline-accent"
          placeholder={transcribing ? '正在识别…' : '输入英文，或点麦克风说话…'}
          value={p.value}
          onChange={(e) => {
            p.onChange(e.target.value)
            if (p.asr && e.target.value === '') p.onClearAsr()
          }}
          onKeyDown={onKey}
          maxLength={4000}
          disabled={recording || transcribing}
        />
        {p.recordingSeconds !== null && (
          <span className="font-mono text-xs text-bad min-w-[42px]">
            {fmt(p.recordingSeconds)} / {fmt(MAX_RECORDING_SECONDS)}
          </span>
        )}
        <button
          className={recording ? `${btn} bg-bad text-white border-transparent` : plain}
          title={recording ? '结束录音' : p.micTitle}
          onClick={p.onMic}
          disabled={p.micDisabled || transcribing || busy || (!recording && !canRecord(p.ui))}
        >
          {recording ? '■' : '🎤'}
        </button>
        {busy || transcribing ? (
          <button
            className={`${btn} bg-bad-soft text-bad`}
            title={transcribing ? '取消识别' : '停止生成'}
            onClick={p.onStop}
          >
            ■
          </button>
        ) : (
          <button
            className={`${btn} bg-accent text-white border-transparent`}
            title="发送"
            onClick={submit}
            disabled={!canSend(p.ui) || !p.value.trim() || sending || recording}
          >
            ➤
          </button>
        )}
      </div>
    </div>
  )
}
