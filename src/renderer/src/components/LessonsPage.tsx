import { useCallback, useEffect, useState } from 'react'
import type { Lesson } from '@shared/types'
import { api } from '../api'

interface Props {
  onNewFromText: () => void
  onNewFromImage: () => void
  onStartQa: (lessonId: string) => void
  refreshKey: number
}

export function LessonsPage({
  onNewFromText,
  onNewFromImage,
  onStartQa,
  refreshKey
}: Props): React.JSX.Element {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 2500)
      return
    }
    setConfirmDelete(false)
    await api.lessons.delete(current.id)
    await reload()
  }
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">课程</h2>
        <button className={btn} onClick={onNewFromText}>
          从文本新建
        </button>
        <button className={btn} onClick={onNewFromImage}>
          从图片识别
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 grid grid-cols-[260px_1fr] gap-4">
        <div className="flex flex-col gap-1">
          {lessons.map((l) => (
            <div
              key={l.id}
              onClick={() => setCurrentId(l.id)}
              className={`px-2.5 py-2 rounded-lg cursor-pointer flex flex-col gap-0.5 ${l.id === currentId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
            >
              <span className="font-medium truncate">{l.title}</span>
              <span className="text-[11.5px] text-fg-3">
                {l.source === 'image' ? '图片' : '文本'} · {l.createdAt.slice(0, 10)} · 生词{' '}
                {l.vocabulary.length}
              </span>
            </div>
          ))}
          {lessons.length === 0 && <div className="text-xs text-fg-3 px-2 py-4">还没有课程</div>}
        </div>
        {current && (
          <div className="border border-line rounded-lg p-4 selectable">
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <h3 className="text-sm font-semibold flex-1 m-0">{current.title}</h3>
              <button
                className={`${btn} bg-accent text-white border-transparent`}
                onClick={() => onStartQa(current.id)}
              >
                开始课文问答
              </button>
              <button className={`${btn} text-bad`} onClick={() => void remove()}>
                {confirmDelete ? '确认删除？' : '删除'}
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
                原图 {current.assets.length} 张已保存在本机
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
