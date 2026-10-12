import { useEffect, useState } from 'react'
import type { ImageInput, LessonExtraction } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'
import { fileToImageInput, rawToImageInput } from '../lib/image'
import { Modal } from './Modal'

type Step = 'input' | 'extracting' | 'edit'
interface Props {
  open: boolean
  onClose: () => void
  initialFiles?: File[]
  pickFromDisk?: boolean
  onSaved?: () => void
}

export function LessonDialog({
  open,
  onClose,
  initialFiles,
  pickFromDisk,
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

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep('input')
      setImages([])
      setText('')
      setDraft(null)
      setError(null)
    }
  }

  useEffect(() => {
    if (!open) return
    const load = async (): Promise<void> => {
      try {
        if (initialFiles?.length)
          setImages(await Promise.all(initialFiles.slice(0, 4).map(fileToImageInput)))
        else if (pickFromDisk) {
          const raw = await api.image.pick()
          setImages(await Promise.all(raw.slice(0, 4).map(rawToImageInput)))
        }
      } catch (e) {
        setError(String((e as Error).message ?? e))
      }
    }
    void load()
  }, [open, initialFiles, pickFromDisk])

  const addFromDisk = async (): Promise<void> => {
    const raw = await api.image.pick()
    const more = await Promise.all(raw.map(rawToImageInput))
    setImages((prev) => [...prev, ...more].slice(0, 4))
  }

  const extract = async (): Promise<void> => {
    setStep('extracting')
    setError(null)
    try {
      const r = await api.lessons.extract({
        images: images.length ? images : undefined,
        text: text.trim() || undefined
      })
      setDraft(r)
      setStep('edit')
    } catch (e) {
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
      title="识别为学习内容"
      footer={
        <>
          <button className="px-3 py-1.5 rounded-md border border-line" onClick={onClose}>
            取消
          </button>
          {step === 'input' && (
            <button
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
              disabled={!canExtract}
              onClick={() => void extract()}
            >
              识别
            </button>
          )}
          {step === 'edit' && (
            <button
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
              disabled={busy || !draft?.title.trim() || !draft?.body.trim()}
              onClick={() => void save()}
            >
              {busy ? '保存中…' : '保存并开始课文问答'}
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-1.5 text-xs text-fg-3">
        <span className={step === 'input' ? 'text-accent font-semibold' : ''}>1 预览</span>
        <span>›</span>
        <span className={step === 'extracting' ? 'text-accent font-semibold' : ''}>2 识别</span>
        <span>›</span>
        <span className={step === 'edit' ? 'text-accent font-semibold' : ''}>3 确认</span>
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
                ＋ 选择图片
              </button>
            )}
          </div>
          <div className="text-[12.5px] px-2.5 py-2 rounded-md bg-warn-soft text-warn">
            图片会发送给 Claude 进行识别。识别完成并确认后，之后的练习只使用文本，不再发送图片。
          </div>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            或者直接粘贴文本（邮件、文档、课文）
            <textarea
              id="lesson-text"
              className={`${field} min-h-[70px]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴英文文本…"
            />
          </label>
        </>
      )}
      {step === 'extracting' && (
        <p className="text-fg-2">
          <span className="inline-block w-3.5 h-3.5 mr-1.5 align-[-2px] rounded-full border-2 border-line border-t-accent animate-spin" />
          正在识别课文、标题和生词…
        </p>
      )}
      {step === 'edit' && draft && (
        <>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            标题
            <input
              id="lesson-title"
              className={field}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            正文（可修改）
            <textarea
              id="lesson-body"
              className={`${field} min-h-[140px] leading-relaxed`}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            中文注释
            <textarea
              id="lesson-notes"
              className={`${field} min-h-[50px]`}
              value={draft.notesZh}
              onChange={(e) => setDraft({ ...draft, notesZh: e.target.value })}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-fg-2">
            生词（点一下删除）
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
