import type { Message } from '@shared/types'
import { CorrectionCard } from './CorrectionCard'
import { VocabChips } from './VocabChips'

export function MessageBubble({
  message,
  onSpeak,
  canSpeak = true
}: {
  message: Message
  onSpeak?: (text: string) => void
  canSpeak?: boolean
}): React.JSX.Element {
  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'
  return (
    <div
      className={`flex flex-col gap-1.5 max-w-[78%] ${isUser ? 'self-end items-end' : 'self-start'}`}
    >
      <div
        className={`px-3 py-2 rounded-xl whitespace-pre-wrap selectable ${isUser ? 'bg-accent text-white rounded-br-sm' : 'bg-ai-bubble rounded-bl-sm'}`}
      >
        {message.content || (streaming ? '' : '…')}
        {streaming && <span className="text-accent animate-pulse">▍</span>}
      </div>
      {!isUser && message.structured?.correction && (
        <CorrectionCard correction={message.structured.correction} />
      )}
      {!isUser && message.structured?.vocabulary?.length ? (
        <VocabChips vocabulary={message.structured.vocabulary} />
      ) : null}
      <div className="text-[11px] text-fg-3 flex gap-2">
        {isUser && message.fromAsr && <span>🎙 语音输入</span>}
        {message.status === 'stopped' && <span>已停止</span>}
        {message.status === 'error' && <span className="text-bad">发送失败</span>}
        {!isUser && message.status === 'done' && onSpeak && (
          <button
            className="text-accent disabled:opacity-40"
            disabled={!canSpeak}
            title={canSpeak ? undefined : '回复生成中，暂不可朗读'}
            onClick={() => onSpeak(message.content)}
          >
            🔈 朗读
          </button>
        )}
      </div>
    </div>
  )
}
