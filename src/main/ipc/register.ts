import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  ConversationIdSchema,
  CreateConversationInputSchema,
  ExtractLessonInputSchema,
  SaveLessonInputSchema,
  SendMessageInputSchema,
  SettingsPatchSchema
} from '@shared/schemas'
import type { ImageInput } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { ChatService } from '../chat/service'
import type { LessonService } from '../lessons/service'
import type { Db } from '../db/index'
import { listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { getSettings, patchSettings } from '../db/settings'
import { registerHandler, registerVoidHandler, type IpcHandleTarget } from './handle'

export interface Services {
  chat: ChatService
  lessons: LessonService
  ai: AIProvider
  db: Db
}

export function registerIpc(
  ipc: IpcHandleTarget,
  { chat, lessons, ai, db }: Services,
  pickImages: () => Promise<ImageInput[]>
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
  registerVoidHandler(ipc, IPC.imagePick, () => pickImages())
}
