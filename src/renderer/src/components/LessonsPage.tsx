import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { Lesson } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'
import { classifyFiles, readTextFiles } from '../lib/dropFiles'

interface Props {
  onNewFromText: () => void
  onNewFromImage: () => void
  onStartQa: (lessonId: string) => void
  onOpenLessonDialog: (files?: File[], text?: string) => void
  refreshKey: number
}

export function LessonsPage({
  onNewFromText,
  onNewFromImage,
  onStartQa,
  onOpenLessonDialog,
  refreshKey
}: Props): React.JSX.Element {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  // 确认状态绑定到具体条目，避免在 A 上点一次、切到 B 再点就删了 B
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resetConfirm = (): void => {
    clearTimeout(confirmTimer.current)
    setConfirmId(null)
  }
  useEffect(() => () => clearTimeout(confirmTimer.current), [])
  const [drag, setDrag] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const dropErrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(dropErrorTimer.current), [])
  const showDropError = (msg: string): void => {
    clearTimeout(dropErrorTimer.current)
    setDropError(msg)
    dropErrorTimer.current = setTimeout(() => setDropError(null), 4000)
  }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDrag(false)
    const { images, texts, other } = classifyFiles(e.dataTransfer.files)
    if (images.length || texts.length) {
      if (!texts.length) onOpenLessonDialog(images)
      else
        void readTextFiles(texts).then(
          (text) => onOpenLessonDialog(images, text),
          (err) => showDropError(String((err as Error)?.message ?? err))
        )
    } else if (other.length) showDropError(t('pages.dropUnsupported'))
  }

  const apply = useCallback((ls: Lesson[]) => {
    setLessons(ls)
    setCurrentId((id) => (id && ls.some((l) => l.id === id) ? id : (ls[0]?.id ?? null)))
  }, [])
  const reload = async (): Promise<void> => apply(await api.lessons.list())
  useEffect(() => {
    void api.lessons.list().then(apply)
  }, [apply, refreshKey])

  const current = lessons.find((l) => l.id === currentId) ?? null
  const remove = async (): Promise<void> => {
    if (!current) return
    if (confirmId !== current.id) {
      clearTimeout(confirmTimer.current)
      setConfirmId(current.id)
      confirmTimer.current = setTimeout(() => setConfirmId(null), 2500)
      return
    }
    resetConfirm()
    await api.lessons.delete(current.id)
    await reload()
  }
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'

  return (
    <div
      className="flex-1 min-w-0 flex flex-col min-h-0 relative"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false)
      }}
      onDrop={onDrop}
    >
      {drag && (
        <div className="absolute inset-0 z-10 bg-accent-soft border-2 border-dashed border-accent flex items-center justify-center text-accent text-base">
          {t('pages.lessons.dropHint')}
        </div>
      )}
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">{t('pages.lessons.title')}</h2>
        <button className={btn} onClick={onNewFromText}>
          {t('pages.lessons.newFromText')}
        </button>
        <button className={btn} onClick={onNewFromImage}>
          {t('pages.lessons.newFromImage')}
        </button>
      </div>
      {dropError && <div className="px-4 py-1.5 text-xs text-bad bg-bad-soft">{dropError}</div>}
      <div className="flex-1 overflow-auto p-4 grid grid-cols-[260px_1fr] gap-4">
        <div className="flex flex-col gap-1">
          {lessons.map((l) => (
            <div
              key={l.id}
              onClick={() => {
                resetConfirm()
                setCurrentId(l.id)
              }}
              className={`px-2.5 py-2 rounded-lg cursor-pointer flex flex-col gap-0.5 ${l.id === currentId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
            >
              <span className="font-medium truncate">{l.title}</span>
              <span className="text-[11.5px] text-fg-3">
                {t('pages.lessons.meta', {
                  source: t(
                    l.source === 'image' ? 'pages.lessons.sourceImage' : 'pages.lessons.sourceText'
                  ),
                  date: l.createdAt.slice(0, 10),
                  count: l.vocabulary.length
                })}
              </span>
            </div>
          ))}
          {lessons.length === 0 && (
            <div className="text-xs text-fg-3 px-2 py-4">{t('pages.lessons.empty')}</div>
          )}
        </div>
        {current && (
          <div className="border border-line rounded-lg p-4 selectable">
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <h3 className="text-sm font-semibold flex-1 m-0">{current.title}</h3>
              <button
                className={`${btn} bg-accent text-white border-transparent`}
                onClick={() => onStartQa(current.id)}
              >
                {t('pages.lessons.startQa')}
              </button>
              <button className={`${btn} text-bad`} onClick={() => void remove()}>
                {confirmId === current.id ? t('pages.confirmDelete') : t('pages.delete')}
              </button>
            </div>
            <div className="whitespace-pre-wrap leading-relaxed text-sm">{current.body}</div>
            {current.notesZh && <p className="text-zh mt-3 mb-1.5">{current.notesZh}</p>}
            <div className="flex flex-wrap gap-1.5">
              {current.vocabulary.map((v) => (
                <span
                  key={v.word}
                  className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs"
                  title={`${v.meaningZh} · ${v.example}`}
                >
                  {v.word}
                </span>
              ))}
            </div>
            {current.assets.length > 0 && (
              <p className="text-xs text-fg-3 mt-2.5">
                {t('pages.lessons.imagesSaved', { count: current.assets.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
