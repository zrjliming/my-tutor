import { useEffect, useState } from 'react'
import type { Lesson, Mode } from '@shared/types'
import { SCENARIOS } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'
import { Modal } from './Modal'
import { t } from '../i18n'

// 名称与说明的文案键：pages.newConv.mode.<mode> / pages.newConv.hint.<mode>
const MODES: Array<{ mode: Mode; disabled?: boolean }> = [
  { mode: 'free' },
  { mode: 'lesson' },
  { mode: 'roleplay' },
  { mode: 'scenario' },
  { mode: 'targeted' }
]

interface Props {
  open: boolean
  onClose: () => void
  presetMode?: Mode
  presetLessonId?: string
}

export function NewConversationDialog({
  open,
  onClose,
  presetMode,
  presetLessonId
}: Props): React.JSX.Element {
  const chat = useChat()
  const [mode, setMode] = useState<Mode>('free')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [lessonId, setLessonId] = useState<string | undefined>()
  const [scenario, setScenario] = useState<string>(SCENARIOS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  const [targetInfo, setTargetInfo] = useState<{
    hasProfile: boolean
    weaknesses: string[]
    due: number
  } | null>(null)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode(presetMode ?? 'free')
      setError(null)
      setTargetInfo(null)
    }
  }

  useEffect(() => {
    if (!open) return
    let alive = true
    void api.lessons.list().then(
      (ls) => {
        if (!alive) return
        setLessons(ls)
        setLessonId(presetLessonId ?? ls[0]?.id)
      },
      (e) => {
        if (alive)
          setError(
            t('pages.newConv.lessonsLoadFailed', { msg: String((e as Error)?.message ?? e) })
          )
      }
    )
    return () => {
      alive = false
    }
  }, [open, presetMode, presetLessonId])

  useEffect(() => {
    if (!open) return
    let alive = true
    void Promise.all([api.learning.profile(), api.mistakes.list('due')]).then(
      ([p, due]) => {
        if (alive)
          setTargetInfo({ hasProfile: !!p, weaknesses: p?.weaknesses ?? [], due: due.length })
      },
      () => {
        if (alive) setTargetInfo({ hasProfile: false, weaknesses: [], due: 0 })
      }
    )
    return () => {
      alive = false
    }
  }, [open])

  const needsLesson = mode === 'lesson'
  const needsScenario = mode === 'roleplay' || mode === 'scenario'
  const canStart = !busy && (!needsLesson || !!lessonId)

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await chat.createConversation({
        mode,
        lessonId: needsLesson ? lessonId : undefined,
        scenario: needsScenario ? scenario : undefined
      })
      onClose()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const chip = (active: boolean): string =>
    `px-2.5 py-1 rounded-full border text-[12.5px] ${active ? 'bg-accent text-white border-transparent' : 'border-line text-fg-2'}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pages.newConv.title')}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-fg-3">
            {t('pages.newConv.fixedNote')}
          </span>
          <button className="px-3 py-1.5 rounded-md border border-line" onClick={onClose}>
            {t('pages.cancel')}
          </button>
          <button
            className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
            disabled={!canStart}
            onClick={() => void start()}
          >
            {busy ? t('pages.newConv.creating') : t('pages.newConv.start')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {MODES.map((m) => (
          <button
            key={m.mode}
            disabled={m.disabled}
            onClick={() => setMode(m.mode)}
            className={`text-left px-3 py-2.5 rounded-lg border flex flex-col gap-0.5 disabled:opacity-40 ${mode === m.mode ? 'border-accent bg-accent-soft' : 'border-line'}`}
          >
            <b className="text-[13px]">{t(`pages.newConv.mode.${m.mode}`)}</b>
            <span className="text-[11.5px] text-fg-2">{t(`pages.newConv.hint.${m.mode}`)}</span>
          </button>
        ))}
      </div>
      {needsLesson && (
        <div className="flex flex-col gap-2">
          <span className="text-fg-3 text-xs">{t('pages.newConv.pickLesson')}</span>
          {lessons.length === 0 ? (
            <span className="text-xs text-warn">{t('pages.newConv.noLessons')}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {lessons.map((l) => (
                <button
                  key={l.id}
                  className={chip(l.id === lessonId)}
                  onClick={() => setLessonId(l.id)}
                >
                  {l.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {needsScenario && (
        <div className="flex flex-col gap-2">
          <span className="text-fg-3 text-xs">{t('pages.newConv.pickScenario')}</span>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((s, i) => (
              <button key={s} className={chip(s === scenario)} onClick={() => setScenario(s)}>
                {t(`pages.newConv.scenario.${i}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === 'targeted' && targetInfo && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-fg-2">
            {t('pages.newConv.targetPlan', {
              focus: targetInfo.weaknesses.length
                ? targetInfo.weaknesses.slice(0, 3).join(t('pages.newConv.listSep'))
                : targetInfo.hasProfile
                  ? t('pages.newConv.noWeakness')
                  : t('pages.newConv.noProfile'),
              due: Math.min(targetInfo.due, 5)
            })}
          </span>
          {targetInfo.weaknesses.length === 0 && targetInfo.due === 0 && (
            <span className="text-fg-3">{t('pages.newConv.generalReview')}</span>
          )}
        </div>
      )}
      {error && <div className="text-xs text-bad">{error}</div>}
    </Modal>
  )
}
