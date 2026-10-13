import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  ConversationIdSchema,
  CreateConversationInputSchema,
  ExtractLessonInputSchema,
  SaveLessonInputSchema,
  SendMessageInputSchema,
  SettingsPatchSchema,
  SpeakInputSchema,
  TranscribeInputSchema
} from '@shared/schemas'
import type { ImageInput } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { ChatService } from '../chat/service'
import type { LessonService } from '../lessons/service'
import type { Db } from '../db/index'
import type { VoiceService } from '../voice/service'
import { listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { getSettings, patchSettings } from '../db/settings'
import { registerHandler, registerVoidHandler, type IpcHandleTarget } from './handle'

export interface Services {
  chat: ChatService
  lessons: LessonService
  ai: AIProvider
  db: Db
  voice: VoiceService
}

export interface IpcHooks {
  pickImages: () => Promise<ImageInput[]>
  requestMic: () => Promise<boolean>
  openMicSettings: () => Promise<void>
}

export function registerIpc(
  ipc: IpcHandleTarget,
  { chat, lessons, ai, db, voice }: Services,
  hooks: IpcHooks
): void {
  registerVoidHandler(ipc, IPC.conversationsList, () => listConversations(db))
  registerHandler(ipc, IPC.conversationsCreate, CreateConversationInputSchema, (i) =>
    chat.createConversation(i)
  )
  registerHandler(ipc, IPC.conversationsDelete, ConversationIdSchema, (id) =>
    chat.deleteConversation(id)
  )
  registerHandler(ipc, IPC.messagesList, ConversationIdSchema, (id) => listMessages(db, id))
  registerHandler(ipc, IPC.chatSend, SendMessageInputSchema, (i) => chat.send(i))
  registerHandler(ipc, IPC.chatCancel, ConversationIdSchema, (id) => {
    chat.cancel(id)
  })
  registerVoidHandler(ipc, IPC.lessonsList, () => lessons.list())
  registerHandler(ipc, IPC.lessonsExtract, ExtractLessonInputSchema, (i) =>
    lessons.extract(i, getSettings(db).model || undefined)
  )
  registerHandler(ipc, IPC.lessonsSave, SaveLessonInputSchema, (i) => lessons.save(i))
  registerHandler(ipc, IPC.lessonsDelete, z.string().uuid(), (id) => lessons.delete(id))
  registerVoidHandler(ipc, IPC.settingsGet, () => getSettings(db))
  registerHandler(ipc, IPC.settingsPatch, SettingsPatchSchema, (p) => patchSettings(db, p))
  registerVoidHandler(ipc, IPC.aiCheck, () => ai.check())
  registerVoidHandler(ipc, IPC.imagePick, () => hooks.pickImages())
  registerVoidHandler(ipc, IPC.voiceStatus, () => voice.status())
  registerHandler(ipc, IPC.voiceTranscribe, TranscribeInputSchema, (i) => voice.transcribe(i.wav))
  registerVoidHandler(ipc, IPC.voiceCancelTranscribe, () => {
    voice.cancelTranscribe()
  })
  registerHandler(ipc, IPC.voiceSpeak, SpeakInputSchema, (i) => voice.speak(i.text))
  registerVoidHandler(ipc, IPC.voiceStopSpeaking, () => voice.stopSpeaking())
  registerVoidHandler(ipc, IPC.voiceListVoices, () => voice.listVoices())
  registerVoidHandler(ipc, IPC.voiceDownloadModel, () => voice.downloadModel())
  registerVoidHandler(ipc, IPC.voiceCancelDownload, () => {
    voice.cancelDownload()
  })
  registerVoidHandler(ipc, IPC.voiceDeleteModel, () => {
    voice.deleteModel()
  })
  registerVoidHandler(ipc, IPC.voiceRequestMic, () => hooks.requestMic())
  registerVoidHandler(ipc, IPC.voiceOpenMicSettings, () => hooks.openMicSettings())
}
