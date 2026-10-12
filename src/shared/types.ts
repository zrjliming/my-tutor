import type { z } from 'zod'
import type {
  ModeSchema,
  DifficultySchema,
  TutorResponseSchema,
  LessonExtractionSchema,
  ImageInputSchema,
  CreateConversationInputSchema,
  SendMessageInputSchema,
  ExtractLessonInputSchema,
  SaveLessonInputSchema,
  SettingsPatchSchema
} from './schemas'

export type Mode = z.infer<typeof ModeSchema>
export type Difficulty = z.infer<typeof DifficultySchema>
export type TutorResponse = z.infer<typeof TutorResponseSchema>
export type LessonExtraction = z.infer<typeof LessonExtractionSchema>
export type ImageInput = z.infer<typeof ImageInputSchema>
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>
export type ExtractLessonInput = z.infer<typeof ExtractLessonInputSchema>
export type SaveLessonInput = z.infer<typeof SaveLessonInputSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const MODE_LABEL: Record<Mode, string> = {
  free: '自由聊天',
  lesson: '课文问答',
  roleplay: '角色扮演',
  scenario: '场景任务',
  targeted: '针对性练习'
}

export interface Conversation {
  id: string
  title: string
  mode: Mode
  lessonId: string | null
  scenario: string | null
  turnCount: number
  sessionStarted: boolean
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  structured: TutorResponse | null
  status: MessageStatus
  fromAsr: boolean
  createdAt: string
}

export interface LessonAsset {
  id: string
  lessonId: string
  path: string
  mime: string
  size: number
}

export interface Lesson {
  id: string
  title: string
  body: string
  source: 'image' | 'text'
  notesZh: string
  vocabulary: Array<{ word: string; meaningZh: string; example: string }>
  createdAt: string
  assets: LessonAsset[]
}

export interface AppSettings {
  model: string
  difficulty: Difficulty
  chineseExplanations: boolean
  autoSpeak: boolean
  voice: string
  rate: number
  whisperBinaryPath: string
  whisperModelPath: string
  lastProfileAnalysisAt: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: '',
  difficulty: 'intermediate',
  chineseExplanations: true,
  autoSpeak: true,
  voice: 'Samantha',
  rate: 175,
  whisperBinaryPath: '/opt/homebrew/bin/whisper-cli',
  whisperModelPath: '',
  lastProfileAnalysisAt: null
}

export type AIErrorKind =
  'not_logged_in' | 'binary_missing' | 'network' | 'rate_limited' | 'aborted' | 'unknown'

export type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; structured?: TutorResponse; rawText: string }
  | { type: 'retrying'; attempt: number }
  | { type: 'error'; kind: AIErrorKind; message: string }

export type ChatIpcEvent = ChatEvent & { conversationId: string; messageId: string }

export interface AICheckResult {
  ok: boolean
  model?: string
  durationMs?: number
  message: string
}
