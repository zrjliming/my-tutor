import type {
  AICheckResult,
  AnalyzeOutcome,
  AppSettings,
  ChatIpcEvent,
  Conversation,
  CreateConversationInput,
  ExtractLessonInput,
  ImageInput,
  Lesson,
  LearnerProfile,
  LearningStats,
  LessonExtraction,
  Message,
  Mistake,
  MistakeFilter,
  ModelProgressEvent,
  SaveLessonInput,
  SendMessageInput,
  SettingsPatch,
  SpeakOutcome,
  TranscribeOutcome,
  TTSVoice,
  VocabEntry,
  VoiceStatus
} from './types'

export const IPC = {
  conversationsList: 'conversations:list',
  conversationsCreate: 'conversations:create',
  conversationsDelete: 'conversations:delete',
  messagesList: 'messages:list',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  lessonsList: 'lessons:list',
  lessonsExtract: 'lessons:extract',
  lessonsSave: 'lessons:save',
  lessonsDelete: 'lessons:delete',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  aiCheck: 'ai:check',
  imagePick: 'image:pick',
  voiceStatus: 'voice:status',
  voiceTranscribe: 'voice:transcribe',
  voiceCancelTranscribe: 'voice:cancelTranscribe',
  voiceSpeak: 'voice:speak',
  voiceStopSpeaking: 'voice:stopSpeaking',
  voiceListVoices: 'voice:listVoices',
  voiceDownloadModel: 'voice:downloadModel',
  voiceCancelDownload: 'voice:cancelDownload',
  voiceDeleteModel: 'voice:deleteModel',
  voiceRequestMic: 'voice:requestMic',
  voiceOpenMicSettings: 'voice:openMicSettings',
  voiceModelProgress: 'voice:modelProgress',
  conversationsEnd: 'conversations:end',
  mistakesList: 'mistakes:list',
  mistakesMaster: 'mistakes:master',
  mistakesDelete: 'mistakes:delete',
  vocabList: 'vocab:list',
  vocabSetFamiliarity: 'vocab:setFamiliarity',
  vocabDelete: 'vocab:delete',
  learningStats: 'learning:stats',
  learningProfile: 'learning:profile',
  learningAnalyze: 'learning:analyze'
} as const

export interface SpeakMateAPI {
  conversations: {
    list(): Promise<Conversation[]>
    create(
      input: CreateConversationInput
    ): Promise<{ conversation: Conversation; assistantMessageId: string }>
    delete(id: string): Promise<void>
    end(id: string): Promise<void>
  }
  messages: {
    list(conversationId: string): Promise<Message[]>
  }
  chat: {
    send(input: SendMessageInput): Promise<{ userMessage: Message; assistantMessageId: string }>
    cancel(conversationId: string): Promise<void>
    onEvent(cb: (event: ChatIpcEvent) => void): () => void
  }
  lessons: {
    list(): Promise<Lesson[]>
    extract(input: ExtractLessonInput): Promise<LessonExtraction>
    save(input: SaveLessonInput): Promise<Lesson>
    delete(id: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    patch(patch: SettingsPatch): Promise<AppSettings>
  }
  ai: {
    check(): Promise<AICheckResult>
  }
  image: {
    pick(): Promise<ImageInput[]>
  }
  voice: {
    status(): Promise<VoiceStatus>
    transcribe(wav: Uint8Array): Promise<TranscribeOutcome>
    cancelTranscribe(): Promise<void>
    speak(text: string): Promise<SpeakOutcome>
    stopSpeaking(): Promise<void>
    listVoices(): Promise<TTSVoice[]>
    downloadModel(): Promise<void>
    cancelDownload(): Promise<void>
    deleteModel(): Promise<void>
    requestMic(): Promise<boolean>
    openMicSettings(): Promise<void>
    onModelProgress(cb: (event: ModelProgressEvent) => void): () => void
  }
  mistakes: {
    list(filter: MistakeFilter): Promise<Mistake[]>
    master(id: string): Promise<void>
    delete(id: string): Promise<void>
  }
  vocab: {
    list(search: string): Promise<VocabEntry[]>
    setFamiliarity(id: string, familiarity: number): Promise<void>
    delete(id: string): Promise<void>
  }
  learning: {
    stats(): Promise<LearningStats>
    profile(): Promise<LearnerProfile | null>
    analyze(): Promise<AnalyzeOutcome>
  }
}
