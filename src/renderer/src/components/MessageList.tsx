import { useEffect, useRef } from 'react'
import type { Message } from '@shared/types'
import { MessageBubble } from './MessageBubble'

export function MessageList({
  messages,
  note,
  onSpeak,
  canSpeak
}: {
  messages: Message[]
  note?: string
  onSpeak?: (text: string) => void
  canSpeak?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const lastContent = messages.at(-1)?.content
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [messages.length, lastContent])
  return (
    <div ref={ref} className="flex-1 overflow-auto p-4 flex flex-col gap-3.5">
      {note && (
        <div className="self-center text-xs text-fg-3 bg-surface-2 px-2.5 py-1 rounded-full">
          {note}
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} onSpeak={onSpeak} canSpeak={canSpeak} />
      ))}
    </div>
  )
}
