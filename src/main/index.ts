import { app, BrowserWindow, dialog, ipcMain, net, shell, systemPreferences } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname, sep } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { ChatIpcEvent, ImageInput, ModelProgressEvent } from '@shared/types'
import { createWindow, installCsp } from './window'
import { resolvePaths } from './paths'
import { openDatabase, type Db } from './db/index'
import { markOrphanedStreamingAsStopped } from './db/messages'
import type { AIProvider } from './ai/types'
import { FakeAIProvider } from './ai/fake'
import { ClaudeCliProvider } from './ai/claude-cli'
import { ChatService } from './chat/service'
import { LessonService } from './lessons/service'
import { registerIpc } from './ipc/register'
import { getSettings } from './db/settings'
import { WhisperCliService, type WhisperConfig } from './asr/whisper-cli'
import { MacSayService } from './tts/mac-say'
import { ModelManager } from './voice/model-manager'
import { resolveWhisperConfig, VoiceService } from './voice/service'

function packagedCliPath(): string | undefined {
  if (!app.isPackaged) return undefined
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`
  try {
    return require.resolve(pkg).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  } catch {
    return undefined // 解析失败退回 SDK 默认路径
  }
}

const MIME_BY_EXT: Record<string, ImageInput['mime']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}
const MAX_PICK_BYTES = 12 * 1024 * 1024

async function pickImages(): Promise<ImageInput[]> {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  })
  const out: ImageInput[] = []
  for (const p of r.filePaths.slice(0, 4)) {
    const mime = MIME_BY_EXT[extname(p).toLowerCase()]
    if (!mime || statSync(p).size > MAX_PICK_BYTES) continue
    out.push({ mime, base64: readFileSync(p).toString('base64'), name: basename(p) })
  }
  return out
}

let chat: ChatService | undefined
let voice: VoiceService | undefined

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mytutor.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  installCsp()

  const paths = resolvePaths(app.getPath('userData'))
  let db: Db
  try {
    db = openDatabase(paths.db)
    markOrphanedStreamingAsStopped(db)
  } catch (e) {
    // 不尝试重建，避免覆盖用户数据
    dialog.showErrorBox('数据库打开失败', String((e as Error)?.message ?? e))
    app.quit()
    return
  }
  const ai: AIProvider =
    process.env.MY_TUTOR_FAKE_AI === '1'
      ? new FakeAIProvider({
          deltaDelayMs: 40,
          analyzeResult: {
            title: 'Lesson 5: Nice to meet you',
            body: 'Good morning.\nGood morning, Mr. Blake.',
            vocabulary: [{ word: 'morning', meaningZh: '早上', example: 'Good morning.' }],
            notesZh: '问候与介绍。'
          }
        })
      : new ClaudeCliProvider({ sessionsDir: paths.sessionsDir, cliPath: packagedCliPath() })
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  const send = (event: ChatIpcEvent): void => broadcast(IPC.chatEvent, event)
  chat = new ChatService({ db, ai, send })
  const lessons = new LessonService({ db, ai, lessonsDir: paths.lessonsDir })

  const resolveConfig = (): WhisperConfig => resolveWhisperConfig(getSettings(db), paths.modelsDir)
  const asr = new WhisperCliService({ getConfig: resolveConfig, tmpDir: paths.tmpDir })
  const tts = new MacSayService()
  const models = new ModelManager({
    modelPath: () => resolveConfig().modelPath,
    fetchFn: (input, init) => net.fetch(input as string, init),
    onProgress: (e: ModelProgressEvent) => broadcast(IPC.voiceModelProgress, e)
  })
  voice = new VoiceService({ asr, tts, models, getSettings: () => getSettings(db), resolveConfig })

  registerIpc(
    ipcMain,
    { chat, lessons, ai, db, voice },
    {
      pickImages,
      requestMic: () => systemPreferences.askForMediaAccess('microphone'),
      openMicSettings: () =>
        shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        )
    }
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  chat?.cancelAll()
  void voice?.shutdown()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
