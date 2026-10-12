import { useState } from 'react'
import { ChatProvider } from './store/ChatStore'
import { Sidebar, type Page } from './components/Sidebar'
import { ChatPage } from './components/ChatPage'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('chat')
  return (
    <ChatProvider>
      <div className="h-full flex bg-surface text-fg">
        <Sidebar page={page} onChange={setPage} />
        <main className="flex-1 min-w-0 flex">
          {page === 'chat' && <ChatPage onOpenLessonDialog={() => {}} />}
          {page === 'lessons' && <div className="p-6 text-fg-2">课程页在 Task 12 实现</div>}
          {page === 'settings' && <div className="p-6 text-fg-2">设置页在 Task 13 实现</div>}
        </main>
      </div>
    </ChatProvider>
  )
}
