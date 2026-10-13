import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabEntry } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'

export function VocabPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<VocabEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(async (q: string) => {
    try {
      setItems(await api.vocab.list(q))
      setError(null)
    } catch (e) {
      setError(t('pages.loadFailed', { msg: String((e as Error)?.message ?? e) }))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    const h = setTimeout(() => void reload(query), 250)
    return () => clearTimeout(h)
  }, [query, reload])
  useEffect(() => () => clearTimeout(timer.current), [])

  const opFail = (e: unknown): void =>
    setError(t('pages.opFailed', { msg: String((e as Error)?.message ?? e) }))
  const setFam = async (v: VocabEntry, f: number): Promise<void> => {
    try {
      await api.vocab.setFamiliarity(v.id, f)
    } catch (e) {
      opFail(e)
      return
    }
    await reload(query)
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
      await api.vocab.delete(id)
    } catch (e) {
      opFail(e)
      return
    }
    await reload(query)
  }

  const mastered = items.filter((v) => v.familiarity >= 5).length
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">{t('pages.vocab.title')}</h2>
        <input
          id="vocab-search"
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm w-48 selectable"
          placeholder={t('pages.vocab.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-fg-3">
          {t('pages.vocab.counts', { total: items.length, mastered })}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2.5">
        {error && <div className="text-xs text-bad">{error}</div>}
        {loaded && items.length === 0 && !error && (
          <p className="text-fg-3 text-sm">
            {query.trim()
              ? t('pages.vocab.notFound', { query: query.trim() })
              : t('pages.vocab.empty')}
          </p>
        )}
        {items.map((v) => (
          <div
            key={v.id}
            className="border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start selectable"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <b>{v.word}</b>
                <span className="text-zh text-sm">{v.meaningZh}</span>
                <span
                  className="inline-flex gap-1"
                  title={t('pages.vocab.familiarity', { n: v.familiarity })}
                >
                  {[1, 2, 3, 4, 5].map((k) => (
                    <button
                      key={k}
                      aria-label={t('pages.vocab.setFamiliarity', { n: k })}
                      onClick={() => void setFam(v, v.familiarity === k ? k - 1 : k)}
                      className={`w-2.5 h-2.5 rounded-full ${k <= v.familiarity ? 'bg-accent' : 'bg-line'}`}
                    />
                  ))}
                </span>
              </div>
              {v.example && <div className="italic text-fg-2 text-[12.5px]">{v.example}</div>}
              <div className="text-[11.5px] text-fg-3">
                {t('pages.vocab.meta', {
                  source: t(
                    v.sourceId === null
                      ? 'pages.vocab.sourceDeleted'
                      : v.source === 'lesson'
                        ? 'pages.vocab.fromLesson'
                        : 'pages.vocab.fromChat'
                  ),
                  count: v.seenCount
                })}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {v.familiarity < 5 && (
                <button className={btn} onClick={() => void setFam(v, 5)}>
                  {t('pages.vocab.markMastered')}
                </button>
              )}
              <button className={`${btn} text-bad`} onClick={() => void remove(v.id)}>
                {confirmId === v.id ? t('pages.confirmDelete') : t('pages.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
