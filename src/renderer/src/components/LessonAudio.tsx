import { useCallback, useEffect, useRef, useState } from 'react'
import type { LessonSentence } from '@shared/types'
import { api } from '../api'
import { t } from '../i18n'

/** 课文逐句音频：单句播放 / 全部顺序播放；切课或离开页面（卸载）即停止 */
export function LessonAudio({ lessonId }: { lessonId: string }): React.JSX.Element | null {
  const [sentences, setSentences] = useState<LessonSentence[]>([])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const doneRef = useRef<(() => void) | null>(null)
  // 每次开始/停止播放都 +1，旧的播放序列看到编号变了就退出
  const runRef = useRef(0)

  useEffect(() => {
    let alive = true
    void api.lessons.sentences(lessonId).then(
      (s) => alive && setSentences(s),
      () => {}
    )
    return () => {
      alive = false
    }
  }, [lessonId])

  const release = (): void => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    const done = doneRef.current
    doneRef.current = null
    done?.()
  }

  const stop = useCallback(() => {
    runRef.current++
    release()
    setPlayingId(null)
  }, [])
  useEffect(() => stop, [stop])

  const playOne = async (s: LessonSentence, run: number): Promise<void> => {
    const bytes = await api.lessons.sentenceAudio(s.id)
    if (run !== runRef.current) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }))
    const audio = new Audio(url)
    urlRef.current = url
    audioRef.current = audio
    await new Promise<void>((resolve, reject) => {
      doneRef.current = resolve
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error(t('pages.lessons.audioFailed')))
      audio.play().catch(reject)
    })
    if (audioRef.current === audio) release()
  }

  const play = async (list: LessonSentence[]): Promise<void> => {
    const run = ++runRef.current
    release()
    setError(null)
    void api.voice.stopSpeaking().catch(() => {})
    try {
      for (const s of list) {
        if (run !== runRef.current) return
        setPlayingId(s.id)
        await playOne(s, run)
      }
    } catch (e) {
      if (run === runRef.current) setError(String((e as Error)?.message ?? e))
    }
    if (run === runRef.current) {
      release()
      setPlayingId(null)
    }
  }

  if (sentences.length === 0) return null
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="mb-3 pb-3 border-b border-line">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-[13px] font-semibold flex-1 m-0">{t('pages.lessons.audioTitle')}</h4>
        <button className={btn} onClick={() => void play(sentences)}>
          {t('pages.lessons.audioPlayAll')}
        </button>
        <button className={btn} onClick={stop} disabled={!playingId}>
          {t('pages.lessons.audioStop')}
        </button>
      </div>
      {error && <p className="text-xs text-bad mb-1.5">{error}</p>}
      <ol className="flex flex-col gap-0.5 m-0 p-0 list-none">
        {sentences.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm ${s.id === playingId ? 'bg-accent-soft text-accent' : ''}`}
          >
            <button
              className="text-xs w-6 h-6 shrink-0 rounded-full border border-line"
              title={t('pages.lessons.audioPlay')}
              aria-label={t('pages.lessons.audioPlay')}
              onClick={() => void play([s])}
            >
              ▶
            </button>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
