import { stripMarkdownEmphasis } from '@shared/plain-text'
import type { Message } from '@shared/types'
import { t } from '../i18n'
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
        {(isUser ? message.content : stripMarkdownEmphasis(message.content)) ||
          (streaming ? '' : '…')}
        {streaming && <span className="text-accent animate-pulse">▍</span>}
      </div>
      {!isUser && message.structured?.correction && (
        <CorrectionCard correction={message.structured.correction} />
      )}
      {!isUser && message.structured?.vocabulary?.length ? (
        <VocabChips vocabulary={message.structured.vocabulary} />
      ) : null}
      <div className="text-[11px] text-fg-3 flex gap-2">
        {isUser && message.fromAsr && <span>{t('chat.message.voiceInput')}</span>}
        {message.status === 'stopped' && <span>{t('chat.message.stopped')}</span>}
        {message.status === 'error' && (
          <span className="text-bad">{t('chat.message.sendFailed')}</span>
        )}
        {!isUser && message.status === 'done' && onSpeak && (
          <button
            className="text-accent disabled:opacity-40"
            disabled={!canSpeak}
            title={canSpeak ? undefined : t('chat.message.speakDisabled')}
            onClick={() => onSpeak(message.content)}
          >
            {t('chat.message.speak')}
          </button>
        )}
      </div>
    </div>
  )
}
