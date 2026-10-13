import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SpeakMateAPI } from '@shared/ipc'
import type { ChatIpcEvent, ModelProgressEvent } from '@shared/types'

const api: SpeakMateAPI = {
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    create: (input) => ipcRenderer.invoke(IPC.conversationsCreate, input),
    delete: (id) => ipcRenderer.invoke(IPC.conversationsDelete, id),
    end: (id) => ipcRenderer.invoke(IPC.conversationsEnd, id)
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
    delete: (id) => ipcRenderer.invoke(IPC.lessonsDelete, id),
    sentences: (lessonId) => ipcRenderer.invoke(IPC.lessonsSentences, lessonId),
    sentenceAudio: (sentenceId) => ipcRenderer.invoke(IPC.lessonsSentenceAudio, sentenceId)
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
  },
  voice: {
    status: () => ipcRenderer.invoke(IPC.voiceStatus),
    transcribe: (wav) => ipcRenderer.invoke(IPC.voiceTranscribe, { wav }),
    cancelTranscribe: () => ipcRenderer.invoke(IPC.voiceCancelTranscribe),
    speak: (text) => ipcRenderer.invoke(IPC.voiceSpeak, { text }),
    stopSpeaking: () => ipcRenderer.invoke(IPC.voiceStopSpeaking),
    listVoices: () => ipcRenderer.invoke(IPC.voiceListVoices),
    downloadModel: () => ipcRenderer.invoke(IPC.voiceDownloadModel),
    cancelDownload: () => ipcRenderer.invoke(IPC.voiceCancelDownload),
    deleteModel: () => ipcRenderer.invoke(IPC.voiceDeleteModel),
    requestMic: () => ipcRenderer.invoke(IPC.voiceRequestMic),
    openMicSettings: () => ipcRenderer.invoke(IPC.voiceOpenMicSettings),
    onModelProgress: (cb) => {
      const listener = (_e: unknown, event: ModelProgressEvent): void => cb(event)
      ipcRenderer.on(IPC.voiceModelProgress, listener)
      return () => {
        ipcRenderer.removeListener(IPC.voiceModelProgress, listener)
      }
    }
  },
  mistakes: {
    list: (filter) => ipcRenderer.invoke(IPC.mistakesList, filter),
    master: (id) => ipcRenderer.invoke(IPC.mistakesMaster, id),
    delete: (id) => ipcRenderer.invoke(IPC.mistakesDelete, id)
  },
  vocab: {
    list: (search) => ipcRenderer.invoke(IPC.vocabList, search),
    setFamiliarity: (id, familiarity) =>
      ipcRenderer.invoke(IPC.vocabSetFamiliarity, { id, familiarity }),
    delete: (id) => ipcRenderer.invoke(IPC.vocabDelete, id)
  },
  learning: {
    stats: () => ipcRenderer.invoke(IPC.learningStats),
    profile: () => ipcRenderer.invoke(IPC.learningProfile),
    analyze: () => ipcRenderer.invoke(IPC.learningAnalyze)
  },
  app: {
    dataDir: () => ipcRenderer.invoke(IPC.appDataDir),
    revealDataDir: () => ipcRenderer.invoke(IPC.appRevealDataDir)
  }
}

contextBridge.exposeInMainWorld('speakmate', api)
