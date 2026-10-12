import { useEffect, useState } from 'react'
import type { ImageInput, Mode } from '@shared/types'
import { api } from './api'
import { ChatProvider } from './store/ChatStore'
import { Sidebar, type Page } from './components/Sidebar'
import { ChatPage } from './components/ChatPage'
import { LessonsPage } from './components/LessonsPage'
import { NewConversationDialog } from './components/NewConversationDialog'
import { LessonDialog } from './components/LessonDialog'
import { SettingsPage } from './components/SettingsPage'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('chat')
  const [newOpen, setNewOpen] = useState<{ mode?: Mode; lessonId?: string } | null>(null)
  const [lessonOpen, setLessonOpen] = useState<{ files?: File[]; raw?: ImageInput[] } | null>(null)
  const [lessonsKey, setLessonsKey] = useState(0)

  useEffect(() => {
    // 拖到聊天区以外的文件默认会让窗口打开该文件，这里统一吞掉
    const block = (e: DragEvent): void => e.preventDefault()
    document.addEventListener('dragover', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragover', block)
      document.removeEventListener('drop', block)
    }
  }, [])

  const pickAndOpen = async (): Promise<void> => {
    const raw = await api.image.pick()
    setLessonOpen({ raw })
  }
  const openLessonDialog = (files?: File[]): void => {
    if (files?.length) setLessonOpen({ files })
    else void pickAndOpen()
  }

  return (
    <ChatProvider>
      <div className="h-full flex bg-surface text-fg">
        <Sidebar page={page} onChange={setPage} />
        <main className="flex-1 min-w-0 flex">
          {page === 'chat' && (
            <ChatPage onOpenLessonDialog={openLessonDialog} onNew={() => setNewOpen({})} />
          )}
          {page === 'lessons' && (
            <LessonsPage
              refreshKey={lessonsKey}
              onNewFromText={() => setLessonOpen({})}
              onNewFromImage={() => void pickAndOpen()}
              onStartQa={(lessonId) => {
                setNewOpen({ mode: 'lesson', lessonId })
                setPage('chat')
              }}
            />
          )}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <NewConversationDialog
        open={newOpen !== null}
        onClose={() => setNewOpen(null)}
        presetMode={newOpen?.mode}
        presetLessonId={newOpen?.lessonId}
      />
      <LessonDialog
        open={lessonOpen !== null}
        onClose={() => setLessonOpen(null)}
        initialFiles={lessonOpen?.files}
        initialRaw={lessonOpen?.raw}
        onSaved={() => {
          setLessonsKey((k) => k + 1)
          setPage('chat')
        }}
      />
    </ChatProvider>
  )
}
