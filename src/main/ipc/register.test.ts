import { describe, it, expect } from 'vitest'
import { IPC } from '@shared/ipc'
import { openDatabase } from '../db/index'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from '../chat/service'
import { LessonService } from '../lessons/service'
import { VoiceService } from '../voice/service'
import { LearningService } from '../learning/service'
import { getSettings } from '../db/settings'
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
    const lessons = new LessonService({ db, ai, lessonsDir: '/tmp/my-tutor-test-lessons' })
    const voice = new VoiceService({
      asr: {
        isReady: async () => ({ binary: false, model: false }),
        transcribe: async () => ({ text: '', confidence: 0, segments: [] })
      },
      tts: { speak: async () => {}, stop: async () => {}, listVoices: async () => [] },
      models: {
        status: () => ({
          modelPath: '/m',
          modelFound: false,
          modelBytes: null,
          downloading: false
        }),
        download: async () => {},
        cancel: () => {},
        delete: () => {}
      } as never,
      getSettings: () => getSettings(db),
      resolveConfig: () => ({ binaryPath: '/nope', modelPath: '/m' })
    })
    const learning = new LearningService({ db, ai })
    registerIpc(
      ipc,
      { chat, lessons, ai, db, voice, learning },
      { pickImages: async () => [], requestMic: async () => true, openMicSettings: async () => {} }
    )
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(IPC)
        .filter((c) => c !== IPC.chatEvent && c !== IPC.voiceModelProgress)
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
    expect(await handlers.get(IPC.voiceStatus)!({})).toMatchObject({
      binaryFound: false,
      modelFound: false
    })
    expect(await handlers.get(IPC.voiceRequestMic)!({})).toBe(true)
    await expect(handlers.get(IPC.voiceTranscribe)!({}, { wav: 'nope' })).rejects.toThrow(
      /参数无效/
    )
    await handlers.get(IPC.settingsPatch)!({}, { uiLanguage: 'en' })
    await expect(handlers.get(IPC.voiceTranscribe)!({}, { wav: 'nope' })).rejects.toThrow(
      /Invalid arguments \(voice:transcribe\)/
    )
    await handlers.get(IPC.settingsPatch)!({}, { uiLanguage: 'zh' })
    await expect(handlers.get(IPC.voiceSpeak)!({}, { text: '' })).rejects.toThrow(/参数无效/)
    expect(await handlers.get(IPC.mistakesList)!({}, 'all')).toEqual([])
    await expect(handlers.get(IPC.mistakesList)!({}, 'spelling')).rejects.toThrow(/参数无效/)
    expect(await handlers.get(IPC.vocabList)!({}, '')).toEqual([])
    await expect(
      handlers.get(IPC.vocabSetFamiliarity)!({}, { id: 'nope', familiarity: 1 })
    ).rejects.toThrow(/参数无效/)
    expect(await handlers.get(IPC.learningStats)!({})).toMatchObject({
      sessions: expect.any(Number)
    })
    expect(await handlers.get(IPC.learningProfile)!({})).toBeNull()
    expect(await handlers.get(IPC.learningAnalyze)!({})).toMatchObject({ ok: false })
    const lessonId = '00000000-0000-4000-8000-000000000001'
    expect(await handlers.get(IPC.lessonsSentences)!({}, lessonId)).toEqual([])
    await expect(handlers.get(IPC.lessonsSentenceAudio)!({}, '/etc/passwd')).rejects.toThrow(
      /参数无效/
    )
    await expect(handlers.get(IPC.lessonsSentenceAudio)!({}, lessonId)).rejects.toThrow(
      /句子不存在/
    )
    await expect(
      handlers.get(IPC.conversationsEnd)!({}, created.conversation.id)
    ).resolves.toBeUndefined()
  })
})
