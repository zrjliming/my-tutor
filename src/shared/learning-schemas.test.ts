import { describe, it, expect } from 'vitest'
import {
  LearnerProfileOutputSchema,
  MistakeFilterSchema,
  SessionSummarySchema,
  VocabFamiliaritySchema,
  VocabSearchSchema
} from './schemas'
import { CATEGORY_LABEL, REVIEW_INTERVALS_DAYS } from './types'

describe('learning schemas', () => {
  it('SessionSummarySchema requires the three fields and caps issues', () => {
    expect(
      SessionSummarySchema.safeParse({ practiced: '点餐', performanceZh: '不错', issues: ['冠词'] })
        .success
    ).toBe(true)
    expect(
      SessionSummarySchema.safeParse({ practiced: '点餐', performanceZh: '不错' }).success
    ).toBe(false)
    expect(
      SessionSummarySchema.safeParse({
        practiced: 'x',
        performanceZh: 'y',
        issues: Array(11).fill('a')
      }).success
    ).toBe(false)
  })
  it('LearnerProfileOutputSchema accepts CEFR levels only', () => {
    const base = {
      weaknesses: ['冠词'],
      progress: [],
      suggestions: ['多练过去式'],
      summaryZh: '总体 B1'
    }
    expect(LearnerProfileOutputSchema.safeParse({ ...base, level: 'B1' }).success).toBe(true)
    expect(LearnerProfileOutputSchema.safeParse({ ...base, level: 'C2' }).success).toBe(false)
  })
  it('MistakeFilterSchema accepts views and categories', () => {
    for (const f of ['all', 'due', 'mastered', 'grammar', 'word_choice', 'naturalness', 'other']) {
      expect(MistakeFilterSchema.safeParse(f).success).toBe(true)
    }
    expect(MistakeFilterSchema.safeParse('spelling').success).toBe(false)
  })
  it('VocabFamiliaritySchema bounds familiarity to integers 0..5', () => {
    const id = '7d2f3a4e-1b2c-4d5e-8f90-123456789abc'
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 0 }).success).toBe(true)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 5 }).success).toBe(true)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 6 }).success).toBe(false)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 2.5 }).success).toBe(false)
  })
  it('VocabSearchSchema trims and bounds', () => {
    expect(VocabSearchSchema.parse('  apple ')).toBe('apple')
    expect(VocabSearchSchema.safeParse('a'.repeat(101)).success).toBe(false)
  })
  it('constants', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([1, 3, 7, 14])
    expect(CATEGORY_LABEL.word_choice).toBe('用词')
  })
})
