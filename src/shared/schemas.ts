import { z } from 'zod'
import { UI_LANGUAGES } from './types'

export const ModeSchema = z.enum(['free', 'lesson', 'roleplay', 'scenario', 'targeted'])
export const DifficultySchema = z.enum(['beginner', 'intermediate', 'advanced'])
export const CorrectionCategorySchema = z.enum(['grammar', 'word_choice', 'naturalness', 'other'])
export const ImageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

const VocabItemSchema = z.object({
  word: z.string().min(1),
  meaningZh: z.string(),
  example: z.string()
})

export const TutorResponseSchema = z.object({
  reply: z.string().min(1),
  correction: z
    .object({
      original: z.string(),
      improved: z.string(),
      explanationZh: z.string(),
      category: CorrectionCategorySchema,
      uncertain: z.boolean().optional()
    })
    .optional(),
  vocabulary: z.array(VocabItemSchema).max(3).optional(),
  nextAction: z.string().optional(),
  taskCompleted: z.boolean().optional()
})

export const LessonExtractionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  vocabulary: z.array(VocabItemSchema).max(15),
  notesZh: z.string()
})

export const ConversationIdSchema = z.string().uuid()

export const CreateConversationInputSchema = z.object({
  mode: ModeSchema,
  lessonId: z.string().uuid().optional(),
  scenario: z.string().min(1).max(40).optional()
})

export const SendMessageInputSchema = z.object({
  conversationId: ConversationIdSchema,
  text: z.string().trim().min(1).max(4000),
  fromAsr: z.boolean().optional()
})

export const ImageInputSchema = z.object({
  mime: ImageMimeSchema,
  base64: z.string().min(1).max(2_100_000),
  name: z.string().max(200).optional()
})

export const ExtractLessonInputSchema = z
  .object({
    images: z.array(ImageInputSchema).max(4).optional(),
    text: z.string().max(20_000).optional()
  })
  .refine((v) => (v.images?.length ?? 0) > 0 || (v.text?.trim().length ?? 0) > 0, {
    message: '需要图片或文本'
  })

export const SaveLessonInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  notesZh: z.string().max(4000),
  vocabulary: z.array(VocabItemSchema).max(30),
  source: z.enum(['image', 'text']),
  images: z.array(ImageInputSchema).max(4).optional()
})

export const SettingsPatchSchema = z.object({
  model: z.string().max(50).optional(),
  difficulty: DifficultySchema.optional(),
  chineseExplanations: z.boolean().optional(),
  autoSpeak: z.boolean().optional(),
  voice: z.string().min(1).max(60).optional(),
  rate: z.number().int().min(100).max(300).optional(),
  whisperBinaryPath: z.string().max(500).optional(),
  whisperModelPath: z.string().max(500).optional(),
  uiLanguage: z.enum(UI_LANGUAGES).optional()
})

export const TranscribeInputSchema = z.object({
  wav: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 44 && b.byteLength <= 2_100_000, { message: '音频大小不合法' })
})

export const SpeakInputSchema = z.object({
  text: z.string().trim().min(1).max(4000)
})

export const IdSchema = z.string().uuid()

export const SessionSummarySchema = z.object({
  practiced: z.string().min(1).max(200),
  performanceZh: z.string().min(1).max(600),
  issues: z.array(z.string().min(1).max(120)).max(10)
})

export const LearnerProfileOutputSchema = z.object({
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
  weaknesses: z.array(z.string().min(1).max(80)).max(8),
  progress: z.array(z.string().min(1).max(120)).max(8),
  suggestions: z.array(z.string().min(1).max(160)).max(8),
  summaryZh: z.string().min(1).max(800)
})

export const MistakeFilterSchema = z.enum([
  'all',
  'due',
  'mastered',
  'grammar',
  'word_choice',
  'naturalness',
  'other'
])

export const VocabSearchSchema = z.string().trim().max(100)

export const VocabFamiliaritySchema = z.object({
  id: z.string().uuid(),
  familiarity: z.number().int().min(0).max(5)
})
