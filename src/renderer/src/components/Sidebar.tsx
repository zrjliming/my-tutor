export type Page = 'chat' | 'lessons' | 'mistakes' | 'vocab' | 'analysis' | 'settings'

const ITEMS: Array<{ key: Page; label: string; icon: string }> = [
  { key: 'chat', label: '聊天', icon: '💬' },
  { key: 'lessons', label: '课程', icon: '📄' },
  { key: 'mistakes', label: '错句本', icon: '✎' },
  { key: 'vocab', label: '生词本', icon: 'Aa' },
  { key: 'analysis', label: '学习分析', icon: '◔' },
  { key: 'settings', label: '设置', icon: '⚙' }
]

export function Sidebar({
  page,
  onChange
}: {
  page: Page
  onChange: (p: Page) => void
}): React.JSX.Element {
  return (
    <nav className="w-[170px] shrink-0 bg-surface-2 border-r border-line pt-10 px-2 pb-3 flex flex-col gap-0.5">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 ${page === it.key ? 'bg-accent-soft text-accent font-semibold' : 'text-fg-2 hover:bg-line/40'}`}
        >
          <span className="w-4 text-center text-fg-3">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
