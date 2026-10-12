import { describe, it, expect } from 'vitest'
import { IPC } from '@shared/ipc'
import { openDatabase } from '../db/index'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from '../chat/service'
import { LessonService } from '../lessons/service'
import { registerIpc } from './register'
import type { IpcHandleTarget } from './handle'

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>

describe('registerIpc', () => {
  it('wires channels end to end with real services', async () => {
    const handlers = new Map<string, Listener>()
    const ipc = {
      handle: (c: string, l: Listener) => handlers.set(c, l)
    } as unknown as IpcHandleTarget
    const db = openDatabase(':memory:')
    const ai = new FakeAIProvider()
    const chat = new ChatService({ db, ai, send: () => {} })
    const lessons = new LessonService({ db, ai, lessonsDir: '/tmp/speakmate-test-lessons' })
    registerIpc(ipc, { chat, lessons, ai, db }, async () => [])
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(IPC)
        .filter((c) => c !== IPC.chatEvent)
        .sort()
    )

    const created = (await handlers.get(IPC.conversationsCreate)!({}, { mode: 'free' })) as {
      conversation: { id: string }
    }
    await chat.whenIdle(created.conversation.id)
    const list = (await handlers.get(IPC.conversationsList)!({})) as unknown[]
    expect(list).toHaveLength(1)
    const msgs = (await handlers.get(IPC.messagesList)!({}, created.conversation.id)) as unknown[]
    expect(msgs).toHaveLength(1)
    await expect(handlers.get(IPC.conversationsCreate)!({}, { mode: 'nope' })).rejects.toThrow(
      /参数无效/
    )
    const settings = (await handlers.get(IPC.settingsPatch)!({}, { difficulty: 'beginner' })) as {
      difficulty: string
    }
    expect(settings.difficulty).toBe('beginner')
    expect(await handlers.get(IPC.aiCheck)!({})).toMatchObject({ ok: true })
  })
})
