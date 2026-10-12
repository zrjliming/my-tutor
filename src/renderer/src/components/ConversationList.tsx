import type { Conversation } from '@shared/types'
import { MODE_LABEL } from '@shared/types'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationList({
  conversations,
  currentId,
  onSelect,
  onNew
}: Props): React.JSX.Element {
  return (
    <div className="w-[230px] shrink-0 border-r border-line flex flex-col min-h-0">
      <div className="flex items-center justify-between px-2.5 pt-10 pb-1.5">
        <h2 className="text-[13px] text-fg-2 font-semibold">会话</h2>
        <button className="text-xs px-2 py-0.5 rounded-md bg-accent text-white" onClick={onNew}>
          ＋ 新建
        </button>
      </div>
      <ul className="overflow-auto flex-1 px-1.5 m-0 p-0 list-none">
        {conversations.map((c) => (
          <li
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`px-2 py-2 rounded-md cursor-pointer flex flex-col gap-0.5 ${c.id === currentId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
          >
            <span className="font-medium truncate">{c.title}</span>
            <span className="text-[11.5px] text-fg-3 flex gap-1.5 items-center">
              <span className="text-[11px] px-1.5 rounded-full bg-accent-soft text-accent">
                {MODE_LABEL[c.mode]}
              </span>
              {c.updatedAt.slice(5, 16).replace('T', ' ')}
            </span>
          </li>
        ))}
        {conversations.length === 0 && (
          <li className="px-2 py-4 text-fg-3 text-xs">还没有会话，点&quot;新建&quot;开始</li>
        )}
      </ul>
    </div>
  )
}
