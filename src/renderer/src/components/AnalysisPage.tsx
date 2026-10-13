import { useCallback, useEffect, useState } from 'react'
import type { LearnerProfile, LearningStats } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'

const fetchAll = (): Promise<[LearningStats, LearnerProfile | null]> =>
  Promise.all([api.learning.stats(), api.learning.profile()])

const pad = (n: number): string => String(n).padStart(2, '0')
const fmt = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AnalysisPage({
  onStartTargeted
}: {
  onStartTargeted: () => void
}): React.JSX.Element {
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [profile, setProfile] = useState<LearnerProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(([s, p]: [LearningStats, LearnerProfile | null]) => {
    setStats(s)
    setProfile(p)
  }, [])
  const fail = useCallback((e: unknown) => {
    setError(t('pages.loadFailed', { msg: String((e as Error)?.message ?? e) }))
  }, [])
  const load = async (): Promise<void> => {
    try {
      apply(await fetchAll())
    } catch (e) {
      fail(e)
    }
  }
  useEffect(() => {
    void fetchAll().then(apply, fail)
  }, [apply, fail])

  const analyze = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.learning.analyze()
      if (r.ok) await load()
      else setError(r.message)
    } catch (e) {
      setError(t('pages.analysis.analyzeFailed', { msg: String((e as Error)?.message ?? e) }))
    } finally {
      setBusy(false)
    }
  }

  const card = 'border border-line rounded-lg px-4 py-3.5 flex flex-col gap-2'
  const famTotal = stats ? Math.max(1, stats.vocabTotal) : 1
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line flex-wrap">
        <h2 className="text-[15px] font-semibold flex-1">{t('pages.analysis.title')}</h2>
        <span className="text-xs text-fg-3">
          {profile
            ? t('pages.analysis.lastAnalyzed', { time: fmt(profile.updatedAt) })
            : t('pages.analysis.never')}
        </span>
        <button
          className="text-xs px-2 py-1 rounded-md border border-line disabled:opacity-50"
          disabled={busy}
          onClick={() => void analyze()}
        >
          {busy ? (
            <>
              <span className="inline-block w-3 h-3 mr-1 align-[-2px] rounded-full border-2 border-line border-t-accent animate-spin" />
              {t('pages.analysis.analyzing')}
            </>
          ) : (
            t('pages.analysis.update')
          )}
        </button>
        <button
          className="text-xs px-2.5 py-1 rounded-md bg-accent text-white"
          onClick={onStartTargeted}
        >
          {t('pages.analysis.startTargeted')}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-3.5 content-start">
        {error && <div className="lg:col-span-2 text-xs text-bad">{error}</div>}
        {profile ? (
          <>
            <section className={card}>
              <div className="text-3xl font-bold text-accent leading-none">
                {profile.level}
                <span className="text-xs font-normal text-fg-2 ml-2">
                  {t('pages.analysis.level')}
                </span>
              </div>
              <p className="text-zh text-sm m-0 selectable">{profile.summaryZh}</p>
            </section>
            <section className={card}>
              <h3 className="text-sm font-semibold m-0">{t('pages.analysis.weaknesses')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.weaknesses.length ? (
                  profile.weaknesses.map((w, i) => (
                    <span
                      key={`${i}-${w}`}
                      className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs"
                    >
                      {w}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-fg-3">{t('pages.none')}</span>
                )}
              </div>
              <h3 className="text-sm font-semibold m-0 mt-2">{t('pages.analysis.progress')}</h3>
              {profile.progress.length ? (
                <ul className="m-0 pl-4 text-sm list-disc">
                  {profile.progress.map((p, i) => (
                    <li key={`${i}-${p}`}>{p}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-fg-3">{t('pages.none')}</span>
              )}
            </section>
            <section className={card}>
              <h3 className="text-sm font-semibold m-0">{t('pages.analysis.suggestions')}</h3>
              <ul className="m-0 pl-4 text-sm list-disc">
                {profile.suggestions.map((s, i) => (
                  <li key={`${i}-${s}`}>{s}</li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <section className={`${card} lg:col-span-2`}>
            <p className="text-sm text-fg-2 m-0">{t('pages.analysis.noProfile')}</p>
          </section>
        )}
        {stats && (
          <section className={card}>
            <h3 className="text-sm font-semibold m-0">{t('pages.analysis.stats')}</h3>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              {(Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>).map((c) => (
                <span key={c} className="contents">
                  <span>
                    {t('pages.analysis.pendingByCategory', { category: t(`pages.category.${c}`) })}
                  </span>
                  <span className="text-right font-semibold">{stats.mistakesByCategory[c]}</span>
                </span>
              ))}
              <span>{t('pages.analysis.due')}</span>
              <span className="text-right font-semibold">{stats.mistakesDue}</span>
              <span>{t('pages.analysis.masteredMistakes')}</span>
              <span className="text-right font-semibold">{stats.mistakesMastered}</span>
              <span>{t('pages.analysis.vocabTotal')}</span>
              <span className="text-right font-semibold">{stats.vocabTotal}</span>
              <span>{t('pages.analysis.sessions')}</span>
              <span className="text-right font-semibold">
                {stats.sessions} / {stats.totalTurns}
              </span>
            </div>
            <div className="flex flex-col gap-1 mt-1">
              {stats.vocabByFamiliarity.map((n, f) => (
                <div key={f} className="flex items-center gap-2 text-xs tabular-nums">
                  <span className="w-14 text-fg-3">
                    {t('pages.analysis.familiarity', { n: f })}
                  </span>
                  <span className="flex-1 h-1.5 rounded bg-line overflow-hidden">
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${(n / famTotal) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 text-right">{n}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
