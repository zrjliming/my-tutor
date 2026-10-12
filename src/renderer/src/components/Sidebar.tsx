export type Page = 'chat' | 'lessons' | 'settings'

const ITEMS: Array<{
  key: Page | 'mistakes' | 'vocab' | 'analysis'
  label: string
  icon: string
  disabled?: boolean
}> = [
  { key: 'chat', label: '聊天', icon: '💬' },
  { key: 'lessons', label: '课程', icon: '📄' },
  { key: 'mistakes', label: '错句本', icon: '✎', disabled: true },
  { key: 'vocab', label: '生词本', icon: 'Aa', disabled: true },
  { key: 'analysis', label: '学习分析', icon: '◔', disabled: true },
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
          disabled={it.disabled}
          title={it.disabled ? '阶段 3 提供' : undefined}
          onClick={() => !it.disabled && onChange(it.key as Page)}
          className={`text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 disabled:opacity-40 ${page === it.key ? 'bg-accent-soft text-accent font-semibold' : 'text-fg-2 hover:bg-line/40'}`}
        >
          <span className="w-4 text-center text-fg-3">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
