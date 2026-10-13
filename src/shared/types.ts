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

/** 课文逐句音频（目前只由导入脚本写入） */
export interface LessonSentence {
  id: string
  idx: number
  text: string
  textZh: string
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

/** 界面语言；新增语言时在这里加代码，并在 renderer/src/i18n/locales 下加同名目录 */
export const UI_LANGUAGES = ['zh', 'en'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

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
  uiLanguage: UiLanguage
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
  lastProfileAnalysisAt: null,
  uiLanguage: 'zh'
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

export const SCENARIOS = ['机场', '出租车', '餐厅', '购物', '看病挂号', '工作会议'] as const

// ---- 语音（阶段 2） ----
export interface ASRResult {
  text: string
  confidence: number
  segments: Array<{ text: string; startMs: number; endMs: number }>
}

export interface TTSVoice {
  id: string
  label: string
  lang: string
}

export interface VoiceStatus {
  binaryPath: string
  binaryFound: boolean
  modelPath: string
  modelFound: boolean
  modelBytes: number | null
  downloading: boolean
}

export type ModelProgressEvent =
  | { type: 'progress'; received: number; total: number | null }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export type ASRErrorKind =
  'binary_missing' | 'model_missing' | 'timeout' | 'aborted' | 'empty' | 'failed'

export type TranscribeOutcome =
  { ok: true; result: ASRResult } | { ok: false; kind: ASRErrorKind; message: string }

export type SpeakOutcome = { ok: true } | { ok: false; kind: 'timeout' | 'failed'; message: string }

export const MAX_RECORDING_SECONDS = 60
export const MAX_WAV_BYTES = 2_100_000
export const ASR_LOW_CONFIDENCE = 0.6
export const SILENCE_RMS = 0.01
export const WHISPER_MODEL_FILE = 'ggml-small.en.bin'
export const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
export const TTS_RATE_MIN = 100
export const TTS_RATE_MAX = 300

// ---- 学习记录与画像（阶段 3） ----
export type CorrectionCategory = 'grammar' | 'word_choice' | 'naturalness' | 'other'

export const CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  grammar: '语法',
  word_choice: '用词',
  naturalness: '地道程度',
  other: '其他'
}

export interface Mistake {
  id: string
  conversationId: string | null
  messageId: string | null
  original: string
  improved: string
  explanationZh: string
  category: CorrectionCategory
  reviewCount: number
  nextReviewAt: string
  status: 'pending' | 'mastered'
  createdAt: string
}

export interface VocabEntry {
  id: string
  word: string
  meaningZh: string
  example: string
  source: 'conversation' | 'lesson'
  sourceId: string | null
  seenCount: number
  familiarity: number
  nextReviewAt: string
  createdAt: string
}

export interface SessionSummary {
  practiced: string
  performanceZh: string
  issues: string[]
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'

export interface LearnerProfile {
  level: CefrLevel
  weaknesses: string[]
  progress: string[]
  suggestions: string[]
  summaryZh: string
  updatedAt: string
}

export interface LearningStats {
  mistakesByCategory: Record<CorrectionCategory, number>
  mistakesPending: number
  mistakesDue: number
  mistakesMastered: number
  vocabTotal: number
  vocabByFamiliarity: number[]
  sessions: number
  totalTurns: number
}

export type MistakeFilter = 'all' | 'due' | 'mastered' | CorrectionCategory

export type AnalyzeOutcome = { ok: true; profile: LearnerProfile } | { ok: false; message: string }

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14] as const
