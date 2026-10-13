import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { ImageInput, LessonExtraction } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'
import { classifyFiles, readTextFiles } from '../lib/dropFiles'
import { fileToImageInput, rawToImageInput } from '../lib/image'
import { Modal } from './Modal'
import { t } from '../i18n'

type Step = 'input' | 'extracting' | 'edit'
interface Props {
  open: boolean
  onClose: () => void
  initialFiles?: File[]
  initialRaw?: ImageInput[]
  initialText?: string
  onSaved?: () => void
}

export function LessonDialog({
  open,
  onClose,
  initialFiles,
  initialRaw,
  initialText,
  onSaved
}: Props): React.JSX.Element {
  const chat = useChat()
  const [step, setStep] = useState<Step>('input')
  const [images, setImages] = useState<ImageInput[]>([])
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<LessonExtraction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  // 每次识别递增；关闭弹窗时也递增，使在途的识别结果作废
  const extractToken = useRef(0)
  useEffect(() => {
    if (!open) extractToken.current++
  }, [open])

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep('input')
      setImages([])
      setText(initialText ?? '')
      setDraft(null)
      setError(null)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        let loaded: ImageInput[] | null = null
        if (initialFiles?.length)
          loaded = await Promise.all(initialFiles.slice(0, 4).map(fileToImageInput))
        else if (initialRaw?.length)
          loaded = await Promise.all(initialRaw.slice(0, 4).map(rawToImageInput))
        if (loaded && !cancelled) setImages(loaded)
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, initialFiles, initialRaw])

  const addFromDisk = async (): Promise<void> => {
    const room = 4 - images.length
    if (room <= 0) return
    try {
      const raw = await api.image.pick()
      const more = await Promise.all(raw.slice(0, room).map(rawToImageInput))
      setImages((prev) => [...prev, ...more].slice(0, 4))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  // 弹窗打开时拖入：图片追加到列表（最多 4 张），文本文件填进粘贴框
  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    if (step !== 'input') return
    const { images: imgs, texts, other } = classifyFiles(e.dataTransfer.files)
    if (!imgs.length && !texts.length) {
      if (other.length) setError(t('pages.dropUnsupported'))
      return
    }
    setError(null)
    try {
      const room = 4 - images.length
      const [more, dropped] = await Promise.all([
        Promise.all(imgs.slice(0, Math.max(room, 0)).map(fileToImageInput)),
        readTextFiles(texts)
      ])
      if (more.length) setImages((prev) => [...prev, ...more].slice(0, 4))
      if (dropped) setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${dropped}` : dropped))
    } catch (err) {
      setError(String((err as Error).message ?? err))
    }
  }

  const extract = async (): Promise<void> => {
    const token = ++extractToken.current
    setStep('extracting')
    setError(null)
    try {
      const r = await api.lessons.extract({
        images: images.length ? images : undefined,
        text: text.trim() || undefined
      })
      if (token !== extractToken.current) return
      setDraft(r)
      setStep('edit')
    } catch (e) {
      if (token !== extractToken.current) return
      setError(String((e as Error).message ?? e))
      setStep('input')
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const lesson = await api.lessons.save({
        ...draft,
        source: images.length ? 'image' : 'text',
        images: images.length ? images : undefined
      })
      onSaved?.()
      await chat.createConversation({ mode: 'lesson', lessonId: lesson.id })
      onClose()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const canExtract = images.length > 0 || text.trim().length > 0
  const field = 'w-full rounded-md border border-line bg-surface px-2 py-1.5 selectable'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pages.lessonDialog.title')}
      onDrop={(e) => void onDrop(e)}
      footer={
        <>
          <button className="px-3 py-1.5 rounded-md border border-line" onClick={onClose}>
            {t('pages.cancel')}
          </button>
          {step === 'input' && (
            <button
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
              disabled={!canExtract}
              onClick={() => void extract()}
            >
              {t('pages.lessonDialog.extract')}
            </button>
          )}
          {step === 'edit' && (
            <button
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
              disabled={busy || !draft?.title.trim() || !draft?.body.trim()}
              onClick={() => void save()}
            >
              {busy ? t('pages.lessonDialog.saving') : t('pages.lessonDialog.saveAndStart')}
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-1.5 text-xs text-fg-3">
        <span className={step === 'input' ? 'text-accent font-semibold' : ''}>
          {t('pages.lessonDialog.step1')}
        </span>
        <span>›</span>
        <span className={step === 'extracting' ? 'text-accent font-semibold' : ''}>
          {t('pages.lessonDialog.step2')}
        </span>
        <span>›</span>
        <span className={step === 'edit' ? 'text-accent font-semibold' : ''}>
          {t('pages.lessonDialog.step3')}
        </span>
      </div>
      {step === 'input' && (
        <>
          <div className="flex flex-wrap gap-2.5">
            {images.map((img, i) => (
              <div
                key={i}
                className="relative w-[130px] h-[96px] rounded-lg border border-line overflow-hidden bg-surface-2"
              >
                <img
                  src={`data:${img.mime};base64,${img.base64}`}
                  className="w-full h-full object-cover"
                  alt=""
                />
                <button
                  className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-surface border border-line text-[11px] leading-none"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <button
                className="w-[130px] h-[96px] rounded-lg border border-dashed border-line text-fg-3 text-xs"
                onClick={() => void addFromDisk()}
              >
                {t('pages.lessonDialog.pickImage')}
              </button>
            )}
          </div>
          <div className="text-[12.5px] px-2.5 py-2 rounded-md bg-warn-soft text-warn">
            {t('pages.lessonDialog.imageNotice')}
          </div>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            {t('pages.lessonDialog.pasteLabel')}
            <textarea
              id="lesson-text"
              className={`${field} min-h-[70px]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('pages.lessonDialog.pastePlaceholder')}
            />
          </label>
        </>
      )}
      {step === 'extracting' && (
        <p className="text-fg-2">
          <span className="inline-block w-3.5 h-3.5 mr-1.5 align-[-2px] rounded-full border-2 border-line border-t-accent animate-spin" />
          {t('pages.lessonDialog.extracting')}
        </p>
      )}
      {step === 'edit' && draft && (
        <>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            {t('pages.lessonDialog.fieldTitle')}
            <input
              id="lesson-title"
              className={field}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            {t('pages.lessonDialog.fieldBody')}
            <textarea
              id="lesson-body"
              className={`${field} min-h-[140px] leading-relaxed`}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            {t('pages.lessonDialog.fieldNotes')}
            <textarea
              id="lesson-notes"
              className={`${field} min-h-[50px]`}
              value={draft.notesZh}
              onChange={(e) => setDraft({ ...draft, notesZh: e.target.value })}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-fg-2">
            {t('pages.lessonDialog.fieldVocab')}
            <div className="flex flex-wrap gap-1.5">
              {draft.vocabulary.map((v) => (
                <button
                  key={v.word}
                  className="px-2.5 py-1 rounded-full bg-accent text-white text-[12.5px]"
                  title={`${v.meaningZh} · ${v.example}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      vocabulary: draft.vocabulary.filter((x) => x.word !== v.word)
                    })
                  }
                >
                  {v.word} {v.meaningZh}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {error && <div className="text-xs text-bad">{error}</div>}
    </Modal>
  )
}
