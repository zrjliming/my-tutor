import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mistake, MistakeFilter } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'

// label 是文案键，渲染时再 t()
const FILTERS: Array<{ key: MistakeFilter; label: string }> = [
  { key: 'all', label: 'pages.mistakes.filterAll' },
  { key: 'due', label: 'pages.mistakes.due' },
  { key: 'grammar', label: 'pages.category.grammar' },
  { key: 'word_choice', label: 'pages.category.word_choice' },
  { key: 'naturalness', label: 'pages.category.naturalness' },
  { key: 'other', label: 'pages.category.other' },
  { key: 'mastered', label: 'pages.mistakes.mastered' }
]

const pad = (n: number): string => String(n).padStart(2, '0')
const md = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

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
    setError(t('pages.loadFailed', { msg: String((e as Error)?.message ?? e) }))
  }, [])
  const opFail = (e: unknown): void =>
    setError(t('pages.opFailed', { msg: String((e as Error)?.message ?? e) }))
  const reload = async (f: MistakeFilter): Promise<void> => load(f).then(apply, fail)

  useEffect(() => {
    let cancelled = false
    void load(filter).then(
      (r) => !cancelled && apply(r),
      (e) => !cancelled && fail(e)
    )
    return () => {
      cancelled = true
    }
  }, [filter, apply, fail])
  useEffect(() => () => clearTimeout(timer.current), [])

  const master = async (id: string): Promise<void> => {
    try {
      await api.mistakes.master(id)
    } catch (e) {
      opFail(e)
      return
    }
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
    try {
      await api.mistakes.delete(id)
    } catch (e) {
      opFail(e)
      return
    }
    await reload(filter)
  }

  const now = new Date().toISOString()
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">{t('pages.mistakes.title')}</h2>
        <span className="text-xs text-fg-3">
          {t('pages.mistakes.counts', { pending: counts.pending, due: counts.due })}
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
              {t(f.label)}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-bad">{error}</div>}
        {items.length === 0 && !error && (
          <p className="text-fg-3 text-sm">{t('pages.mistakes.empty')}</p>
        )}
        {items.map((m) => (
          <div
            key={m.id}
            className="border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start selectable"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-1.5 rounded-full bg-surface-2 border border-line text-fg-2">
                  {t(`pages.category.${m.category}`)}
                </span>
                {m.status === 'mastered' ? (
                  <span className="px-1.5 rounded bg-good-soft text-good">
                    {t('pages.mistakes.mastered')}
                  </span>
                ) : m.nextReviewAt <= now ? (
                  <span className="px-1.5 rounded bg-warn-soft text-warn">
                    {t('pages.mistakes.due')}
                  </span>
                ) : (
                  <span className="text-fg-3">
                    {t('pages.mistakes.reviewed', {
                      count: m.reviewCount,
                      date: md(m.nextReviewAt)
                    })}
                  </span>
                )}
                {m.conversationId === null && (
                  <span className="text-fg-3">{t('pages.mistakes.sourceDeleted')}</span>
                )}
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
                  {t('pages.mistakes.markMastered')}
                </button>
              )}
              <button className={`${btn} text-bad`} onClick={() => void remove(m.id)}>
                {confirmId === m.id ? t('pages.confirmDelete') : t('pages.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
