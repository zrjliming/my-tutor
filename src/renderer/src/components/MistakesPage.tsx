import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mistake, MistakeFilter } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../api'

const FILTERS: Array<{ key: MistakeFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '到期复习' },
  { key: 'grammar', label: '语法' },
  { key: 'word_choice', label: '用词' },
  { key: 'naturalness', label: '地道程度' },
  { key: 'other', label: '其他' },
  { key: 'mastered', label: '已掌握' }
]

const md = (iso: string): string => iso.slice(5, 10)

const load = (f: MistakeFilter): Promise<Mistake[][]> =>
  Promise.all([api.mistakes.list(f), api.mistakes.list('all'), api.mistakes.list('due')])

export function MistakesPage(): React.JSX.Element {
  const [filter, setFilter] = useState<MistakeFilter>('all')
  const [items, setItems] = useState<Mistake[]>([])
  const [counts, setCounts] = useState({ pending: 0, due: 0 })
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const apply = useCallback(([list, all, due]: Mistake[][]) => {
    setItems(list)
    setCounts({ pending: all.length, due: due.length })
    setError(null)
  }, [])
  const fail = useCallback((e: unknown) => {
    setError(`加载失败：${String((e as Error)?.message ?? e)}`)
  }, [])
  const reload = async (f: MistakeFilter): Promise<void> => load(f).then(apply, fail)

  useEffect(() => {
    void load(filter).then(apply, fail)
  }, [filter, apply, fail])
  useEffect(() => () => clearTimeout(timer.current), [])

  const master = async (id: string): Promise<void> => {
    await api.mistakes.master(id)
    await reload(filter)
  }
  const remove = async (id: string): Promise<void> => {
    if (confirmId !== id) {
      clearTimeout(timer.current)
      setConfirmId(id)
      timer.current = setTimeout(() => setConfirmId(null), 2500)
      return
    }
    clearTimeout(timer.current)
    setConfirmId(null)
    await api.mistakes.delete(id)
    await reload(filter)
  }

  const now = new Date().toISOString()
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">错句本</h2>
        <span className="text-xs text-fg-3">
          待复习 {counts.pending} 条 · 其中到期 {counts.due} 条
        </span>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-full border text-xs ${filter === f.key ? 'bg-accent text-white border-transparent' : 'border-line text-fg-2'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-bad">{error}</div>}
        {items.length === 0 && !error && (
          <p className="text-fg-3 text-sm">
            这个分类下没有错句。和 AI 多聊几轮，纠错会自动收进来。
          </p>
        )}
        {items.map((m) => (
          <div
            key={m.id}
            className="border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start selectable"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-1.5 rounded-full bg-surface-2 border border-line text-fg-2">
                  {CATEGORY_LABEL[m.category]}
                </span>
                {m.status === 'mastered' ? (
                  <span className="px-1.5 rounded bg-good-soft text-good">已掌握</span>
                ) : m.nextReviewAt <= now ? (
                  <span className="px-1.5 rounded bg-warn-soft text-warn">到期复习</span>
                ) : (
                  <span className="text-fg-3">
                    已复习 {m.reviewCount} 次 · 下次 {md(m.nextReviewAt)}
                  </span>
                )}
                {m.conversationId === null && <span className="text-fg-3">来源会话已删除</span>}
              </div>
              <div className="text-sm">
                <span className="line-through text-bad">{m.original}</span>
                <span className="text-fg-3 mx-1.5">→</span>
                <span className="text-good font-semibold">{m.improved}</span>
              </div>
              <div className="text-[12.5px] text-zh">{m.explanationZh}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {m.status !== 'mastered' && (
                <button className={btn} onClick={() => void master(m.id)}>
                  标记已掌握
                </button>
              )}
              <button className={`${btn} text-bad`} onClick={() => void remove(m.id)}>
                {confirmId === m.id ? '确认删除？' : '删除'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
