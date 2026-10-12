import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, EXTRACT_LESSON_PROMPT, OPENING_INSTRUCTION, SCENARIOS } from './prompts'

const base = { difficulty: 'intermediate' as const, chineseExplanations: true }

describe('buildSystemPrompt', () => {
  it('always includes the base tutor rules and the difficulty', () => {
    const p = buildSystemPrompt({ ...base, mode: 'free' })
    expect(p).toContain('write your reply to the learner as plain text first')
    expect(p).toContain('Learner level: intermediate')
    expect(p).toContain('at most 3 new words')
  })
  it('includes lesson text only in lesson mode', () => {
    const lesson = { title: 'Lesson 5', body: 'Good morning, Mr. Blake.', notesZh: '介绍他人' }
    expect(buildSystemPrompt({ ...base, mode: 'lesson', lesson })).toContain(
      'Good morning, Mr. Blake.'
    )
    expect(buildSystemPrompt({ ...base, mode: 'free', lesson })).not.toContain(
      'Good morning, Mr. Blake.'
    )
  })
  it('throws when lesson mode has no lesson', () => {
    expect(() => buildSystemPrompt({ ...base, mode: 'lesson' })).toThrow(/lesson/)
  })
  it('includes the scenario in roleplay and scenario modes', () => {
    expect(buildSystemPrompt({ ...base, mode: 'roleplay', scenario: '餐厅' })).toContain('餐厅')
    expect(buildSystemPrompt({ ...base, mode: 'scenario', scenario: '机场' })).toContain(
      'taskCompleted'
    )
  })
  it('turns Chinese explanations off when asked', () => {
    expect(buildSystemPrompt({ ...base, mode: 'free', chineseExplanations: false })).toContain(
      'explanationZh in simple English'
    )
  })
  it('appends the learner profile when present', () => {
    expect(
      buildSystemPrompt({ ...base, mode: 'free', profileSummary: 'Level B1. Weak: articles.' })
    ).toContain('Weak: articles.')
  })
  it('rejects targeted mode for now', () => {
    expect(() => buildSystemPrompt({ ...base, mode: 'targeted' })).toThrow(/targeted/)
  })
  it('exports constants', () => {
    expect(EXTRACT_LESSON_PROMPT).toContain('vocabulary')
    expect(OPENING_INSTRUCTION).toContain('Greet')
    expect(SCENARIOS).toContain('餐厅')
  })
})
