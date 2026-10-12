import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SpeakMateAPI } from '@shared/ipc'
import type { ChatIpcEvent } from '@shared/types'

const api: SpeakMateAPI = {
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    create: (input) => ipcRenderer.invoke(IPC.conversationsCreate, input),
    delete: (id) => ipcRenderer.invoke(IPC.conversationsDelete, id)
  },
  messages: {
    list: (conversationId) => ipcRenderer.invoke(IPC.messagesList, conversationId)
  },
  chat: {
    send: (input) => ipcRenderer.invoke(IPC.chatSend, input),
    cancel: (conversationId) => ipcRenderer.invoke(IPC.chatCancel, conversationId),
    onEvent: (cb) => {
      const listener = (_e: unknown, event: ChatIpcEvent): void => cb(event)
      ipcRenderer.on(IPC.chatEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.chatEvent, listener)
      }
    }
  },
  lessons: {
    list: () => ipcRenderer.invoke(IPC.lessonsList),
    extract: (input) => ipcRenderer.invoke(IPC.lessonsExtract, input),
    save: (input) => ipcRenderer.invoke(IPC.lessonsSave, input),
    delete: (id) => ipcRenderer.invoke(IPC.lessonsDelete, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    patch: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch)
  },
  ai: {
    check: () => ipcRenderer.invoke(IPC.aiCheck)
  },
  image: {
    pick: () => ipcRenderer.invoke(IPC.imagePick)
  }
}

contextBridge.exposeInMainWorld('speakmate', api)
