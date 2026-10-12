import { describe, it, expect } from 'vitest'
import {
  TutorResponseSchema,
  LessonExtractionSchema,
  ExtractLessonInputSchema,
  SendMessageInputSchema,
  CreateConversationInputSchema
} from './schemas'

const img = (n = 1): { mime: 'image/png'; base64: string } => ({
  mime: 'image/png',
  base64: 'A'.repeat(n)
})

describe('TutorResponseSchema', () => {
  it('accepts a minimal reply', () => {
    expect(TutorResponseSchema.safeParse({ reply: 'Hi!' }).success).toBe(true)
  })
  it('rejects empty reply and unknown category', () => {
    expect(TutorResponseSchema.safeParse({ reply: '' }).success).toBe(false)
    expect(
      TutorResponseSchema.safeParse({
        reply: 'x',
        correction: { original: 'a', improved: 'b', explanationZh: 'c', category: 'spelling' }
      }).success
    ).toBe(false)
  })
  it('caps vocabulary at 3', () => {
    const v = { word: 'w', meaningZh: 'm', example: 'e' }
    expect(TutorResponseSchema.safeParse({ reply: 'x', vocabulary: [v, v, v] }).success).toBe(true)
    expect(TutorResponseSchema.safeParse({ reply: 'x', vocabulary: [v, v, v, v] }).success).toBe(
      false
    )
  })
})

describe('LessonExtractionSchema', () => {
  it('requires title and body', () => {
    expect(
      LessonExtractionSchema.safeParse({ title: 'L5', body: 'text', vocabulary: [], notesZh: '' })
        .success
    ).toBe(true)
    expect(
      LessonExtractionSchema.safeParse({ title: '', body: 'text', vocabulary: [], notesZh: '' })
        .success
    ).toBe(false)
  })
})

describe('ExtractLessonInputSchema', () => {
  it('needs images or text', () => {
    expect(ExtractLessonInputSchema.safeParse({}).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ text: 'Hello' }).success).toBe(true)
    expect(ExtractLessonInputSchema.safeParse({ images: [img()] }).success).toBe(true)
  })
  it('rejects more than 4 images, bad mime, oversized base64', () => {
    expect(
      ExtractLessonInputSchema.safeParse({ images: [img(), img(), img(), img(), img()] }).success
    ).toBe(false)
    expect(
      ExtractLessonInputSchema.safeParse({ images: [{ mime: 'image/gif', base64: 'A' }] }).success
    ).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ images: [img(2_100_001)] }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ images: [img(2_100_000)] }).success).toBe(true)
  })
})

describe('SendMessageInputSchema / CreateConversationInputSchema', () => {
  it('trims and bounds text, requires uuid', () => {
    const id = '7d2f3a4e-1b2c-4d5e-8f90-123456789abc'
    expect(SendMessageInputSchema.parse({ conversationId: id, text: '  hi ' }).text).toBe('hi')
    expect(SendMessageInputSchema.safeParse({ conversationId: 'nope', text: 'hi' }).success).toBe(
      false
    )
    expect(SendMessageInputSchema.safeParse({ conversationId: id, text: ' ' }).success).toBe(false)
  })
  it('validates mode', () => {
    expect(CreateConversationInputSchema.safeParse({ mode: 'free' }).success).toBe(true)
    expect(CreateConversationInputSchema.safeParse({ mode: 'karaoke' }).success).toBe(false)
  })
})
