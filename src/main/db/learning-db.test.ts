import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from './index'
import { insertConversation, deleteConversation } from './conversations'
import { insertMessage } from './messages'
import { insertLesson, deleteLesson } from './lessons'
import {
  deleteMistake,
  dueMistakes,
  getMistakesByIds,
  insertMistake,
  listMistakes,
  markMistakeReviewed,
  mistakesForConversation,
  recentMistakes,
  setMistakeMastered
} from './mistakes'
import {
  clearVocabSource,
  deleteVocab,
  listVocab,
  setVocabFamiliarity,
  upsertVocab
} from './vocabulary'
import {
  getPracticeSession,
  insertPracticeSession,
  markReviewsApplied,
  markSessionEnded,
  reopenSession,
  recentSummaries,
  saveSessionSummary,
  sessionsNeedingSummary,
  summariesSince
} from './practice'
import { getProfile, saveProfile } from './profile'
import { learningStats } from './stats'
import { addDays } from '../learning/review'
import type { Conversation } from '@shared/types'

const NOW = '2026-10-13T08:00:00.000Z'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  title: 't',
  mode: 'free',
  lessonId: null,
  scenario: null,
  turnCount: 0,
  sessionStarted: true,
  createdAt: NOW,
  updatedAt: NOW,
  endedAt: null,
  ...over
})
const mistake = (
  over: Partial<Parameters<typeof insertMistake>[1]> = {}
): Parameters<typeof insertMistake>[1] => ({
  conversationId: C1,
  messageId: null,
  original: 'I goed',
  improved: 'I went',
  explanationZh: 'go 的过去式是 went',
  category: 'grammar',
  ...over
})
let n = 0
const uid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  n = 0
  insertConversation(db, conv(C1, { turnCount: 4 }))
  insertConversation(db, conv(C2, { turnCount: 1 }))
})

describe('mistakes', () => {
  it('inserts with first review in one day and skips same-conversation duplicates', () => {
    expect(insertMistake(db, mistake(), NOW, uid())).toBe(true)
    expect(insertMistake(db, mistake(), NOW, uid())).toBe(false)
    expect(insertMistake(db, mistake({ conversationId: C2 }), NOW, uid())).toBe(true)
    const all = listMistakes(db, 'all', NOW)
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({
      reviewCount: 0,
      status: 'pending',
      nextReviewAt: addDays(NOW, 1)
    })
  })
  it('filters: due / category / mastered, due ordered by next_review_at', () => {
    const a = uid()
    const b = uid()
    const c = uid()
    insertMistake(db, mistake({ original: 'a' }), NOW, a)
    insertMistake(db, mistake({ original: 'b', category: 'word_choice' }), addDays(NOW, -5), b)
    insertMistake(db, mistake({ original: 'c' }), addDays(NOW, -3), c)
    expect(listMistakes(db, 'due', NOW).map((m) => m.original)).toEqual(['b', 'c'])
    expect(listMistakes(db, 'word_choice', NOW).map((m) => m.original)).toEqual(['b'])
    setMistakeMastered(db, c)
    expect(listMistakes(db, 'mastered', NOW).map((m) => m.original)).toEqual(['c'])
    expect(listMistakes(db, 'all', NOW).map((m) => m.original)).toEqual(['b', 'a'])
    expect(dueMistakes(db, NOW, 5).map((m) => m.id)).toEqual([b])
  })
  it('review advances the schedule; mastered ones are not reviewed', () => {
    const a = uid()
    insertMistake(db, mistake(), NOW, a)
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0]).toMatchObject({
      reviewCount: 1,
      nextReviewAt: addDays(NOW, 3)
    })
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0]).toMatchObject({
      reviewCount: 2,
      nextReviewAt: addDays(NOW, 7)
    })
    setMistakeMastered(db, a)
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0].reviewCount).toBe(2)
  })
  it('getMistakesByIds keeps order and skips missing; delete works', () => {
    const a = uid()
    const b = uid()
    insertMistake(db, mistake({ original: 'a' }), NOW, a)
    insertMistake(db, mistake({ original: 'b' }), NOW, b)
    expect(getMistakesByIds(db, [b, 'missing', a]).map((m) => m.id)).toEqual([b, a])
    deleteMistake(db, a)
    expect(getMistakesByIds(db, [a])).toEqual([])
  })
  it('deleting a conversation keeps its mistakes with null sources', () => {
    insertMessage(db, {
      id: 'm1',
      conversationId: C1,
      role: 'assistant',
      content: 'x',
      structured: null,
      status: 'done',
      fromAsr: false,
      createdAt: NOW
    })
    insertMistake(db, mistake({ messageId: 'm1' }), NOW, uid())
    deleteConversation(db, C1)
    expect(listMistakes(db, 'all', NOW)[0]).toMatchObject({ conversationId: null, messageId: null })
  })
  it('per-conversation and recent queries', () => {
    insertMistake(db, mistake(), addDays(NOW, -40), uid())
    insertMistake(db, mistake({ original: 'new' }), NOW, uid())
    expect(mistakesForConversation(db, C1)).toHaveLength(2)
    expect(recentMistakes(db, addDays(NOW, -30)).map((m) => m.original)).toEqual(['new'])
  })
})

describe('vocabulary', () => {
  it('upserts case-insensitively, counting sightings without overwriting meaning', () => {
    upsertVocab(
      db,
      { word: 'Commute', meaningZh: '通勤', example: 'e1', source: 'conversation', sourceId: C1 },
      NOW,
      uid()
    )
    upsertVocab(
      db,
      { word: 'commute', meaningZh: '别的', example: 'e2', source: 'lesson', sourceId: null },
      NOW,
      uid()
    )
    const [v] = listVocab(db, '')
    expect(v).toMatchObject({
      word: 'Commute',
      meaningZh: '通勤',
      seenCount: 2,
      familiarity: 0,
      source: 'conversation',
      sourceId: C1
    })
  })
  it('search matches word or meaning; ordering by familiarity then newest', () => {
    const a = uid()
    upsertVocab(
      db,
      { word: 'apple', meaningZh: '苹果', example: '', source: 'lesson', sourceId: null },
      NOW,
      a
    )
    upsertVocab(
      db,
      { word: 'banana', meaningZh: '香蕉', example: '', source: 'lesson', sourceId: null },
      addDays(NOW, 1),
      uid()
    )
    expect(listVocab(db, '').map((v) => v.word)).toEqual(['banana', 'apple'])
    setVocabFamiliarity(db, a, 3)
    expect(listVocab(db, '').map((v) => v.word)).toEqual(['banana', 'apple'])
    expect(listVocab(db, '苹').map((v) => v.word)).toEqual(['apple'])
    expect(listVocab(db, 'BAN').map((v) => v.word)).toEqual(['banana'])
    deleteVocab(db, a)
    expect(listVocab(db, 'apple')).toEqual([])
  })
  it('clears sources when a conversation or lesson is deleted', () => {
    const L = '33333333-3333-4333-8333-333333333333'
    insertLesson(db, {
      id: L,
      title: 'L',
      body: 'b',
      source: 'text',
      notesZh: '',
      vocabulary: [],
      createdAt: NOW,
      assets: []
    })
    upsertVocab(
      db,
      { word: 'a', meaningZh: '', example: '', source: 'conversation', sourceId: C1 },
      NOW,
      uid()
    )
    upsertVocab(
      db,
      { word: 'b', meaningZh: '', example: '', source: 'lesson', sourceId: L },
      NOW,
      uid()
    )
    deleteConversation(db, C1)
    deleteLesson(db, L)
    expect(listVocab(db, '').every((v) => v.sourceId === null)).toBe(true)
    clearVocabSource(db, 'lesson', 'nothing')
  })
})

describe('practice sessions, profile, stats', () => {
  it('practice session lifecycle', () => {
    insertPracticeSession(db, C1, 'targeted', NOW, ['x', 'y'])
    markSessionEnded(db, C1, NOW)
    markSessionEnded(db, C1, addDays(NOW, 1))
    expect(getPracticeSession(db, C1)).toMatchObject({
      mode: 'targeted',
      endedAt: NOW,
      reviewedMistakeIds: ['x', 'y'],
      reviewsApplied: false,
      summary: null
    })
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([C1])
    markReviewsApplied(db, C1)
    saveSessionSummary(db, C1, { practiced: '点餐', performanceZh: '好', issues: ['冠词'] })
    expect(getPracticeSession(db, C1)).toMatchObject({
      reviewsApplied: true,
      summary: { practiced: '点餐' }
    })
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([])
    // 小结生成期间被重开：过时小结不写入
    reopenSession(db, C1)
    saveSessionSummary(db, C1, { practiced: '旧', performanceZh: '旧', issues: [] })
    expect(getPracticeSession(db, C1)?.summary).toBeNull()
    markSessionEnded(db, C1, NOW)
    saveSessionSummary(db, C1, { practiced: '点餐', performanceZh: '好', issues: ['冠词'] })
    expect(recentSummaries(db, 10)).toEqual([
      {
        conversationId: C1,
        endedAt: NOW,
        summary: { practiced: '点餐', performanceZh: '好', issues: ['冠词'] }
      }
    ])
    expect(summariesSince(db, addDays(NOW, -1))).toBe(1)
  })
  it('sessions below the turn threshold or not ended are not summarized', () => {
    insertPracticeSession(db, C2, 'free', NOW, [])
    markSessionEnded(db, C2, NOW)
    insertPracticeSession(db, C1, 'free', NOW, [])
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([])
  })
  it('profile round-trips and overwrites the single row', () => {
    expect(getProfile(db)).toBeNull()
    const p = {
      level: 'B1' as const,
      weaknesses: ['冠词'],
      progress: [],
      suggestions: ['多练'],
      summaryZh: '中级',
      updatedAt: NOW
    }
    saveProfile(db, p)
    saveProfile(db, { ...p, level: 'B2' })
    expect(getProfile(db)).toEqual({ ...p, level: 'B2' })
  })
  it('stats', () => {
    insertMistake(db, mistake(), addDays(NOW, -2), uid())
    insertMistake(db, mistake({ original: 'x', category: 'naturalness' }), NOW, uid())
    const m = uid()
    insertMistake(db, mistake({ original: 'y' }), NOW, m)
    setMistakeMastered(db, m)
    const a = uid()
    upsertVocab(
      db,
      { word: 'a', meaningZh: '', example: '', source: 'lesson', sourceId: null },
      NOW,
      a
    )
    upsertVocab(
      db,
      { word: 'b', meaningZh: '', example: '', source: 'lesson', sourceId: null },
      NOW,
      uid()
    )
    setVocabFamiliarity(db, a, 5)
    insertPracticeSession(db, C1, 'free', NOW, [])
    insertPracticeSession(db, C2, 'free', NOW, [])
    // 一轮都没说的会话不算练习次数
    const C3 = '33333333-3333-4333-8333-333333333333'
    insertConversation(db, conv(C3, { turnCount: 0 }))
    insertPracticeSession(db, C3, 'free', NOW, [])
    expect(learningStats(db, NOW)).toEqual({
      mistakesByCategory: { grammar: 1, word_choice: 0, naturalness: 1, other: 0 },
      mistakesPending: 2,
      mistakesDue: 1,
      mistakesMastered: 1,
      vocabTotal: 2,
      vocabByFamiliarity: [1, 0, 0, 0, 0, 1],
      sessions: 2,
      totalTurns: 5
    })
  })
})
