import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/index'
import { insertConversation } from '../db/conversations'
import { insertMessage } from '../db/messages'
import { getMistakesByIds, insertMistake } from '../db/mistakes'
import {
  getPracticeSession,
  insertPracticeSession,
  markSessionEnded,
  saveSessionSummary
} from '../db/practice'
import { getProfile, saveProfile } from '../db/profile'
import { getSettings, patchSettings } from '../db/settings'
import { FakeAIProvider } from '../ai/fake'
import { addDays } from './review'
import { buildSummaryInput, LearningService } from './service'
import type { AnalyzeRequest } from '../ai/types'
import type { Conversation } from '@shared/types'

const NOW = '2026-10-13T08:00:00.000Z'
const C = '11111111-1111-4111-8111-111111111111'
const M = '22222222-2222-4222-8222-222222222222'
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: C,
  title: 't',
  mode: 'free',
  lessonId: null,
  scenario: null,
  turnCount: 3,
  sessionStarted: true,
  createdAt: NOW,
  updatedAt: NOW,
  endedAt: null,
  ...over
})
const summary = { practiced: '点餐', performanceZh: '表达流畅', issues: ['冠词'] }
const profileOut = {
  level: 'B1',
  weaknesses: ['冠词'],
  progress: [],
  suggestions: ['多练'],
  summaryZh: '中级'
}

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})

const seedTalk = (): void => {
  insertMessage(db, {
    id: 'u1',
    conversationId: C,
    role: 'user',
    content: 'I goed home',
    structured: null,
    status: 'done',
    fromAsr: true,
    createdAt: NOW
  })
  insertMessage(db, {
    id: 'a1',
    conversationId: C,
    role: 'assistant',
    content: 'You went home!',
    structured: null,
    status: 'done',
    fromAsr: false,
    createdAt: addDays(NOW, 0.0001)
  })
  insertMessage(db, {
    id: 'a2',
    conversationId: C,
    role: 'assistant',
    content: '',
    structured: null,
    status: 'error',
    fromAsr: false,
    createdAt: addDays(NOW, 0.0002)
  })
}

describe('LearningService.endConversation', () => {
  it('marks ended, applies targeted reviews once, summarizes when long enough', async () => {
    insertConversation(db, conv({ mode: 'targeted' }))
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'x',
        improved: 'y',
        explanationZh: 'z',
        category: 'grammar'
      },
      addDays(NOW, -3),
      M
    )
    insertPracticeSession(db, C, 'targeted', NOW, [M])
    seedTalk()
    const ai = new FakeAIProvider({ analyzeResult: summary })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await svc.endConversation(C)
    await svc.endConversation(C)
    expect(getMistakesByIds(db, [M])[0].reviewCount).toBe(1)
    expect(getPracticeSession(db, C)).toMatchObject({ endedAt: NOW, reviewsApplied: true, summary })
    expect(ai.analyzeCalls).toHaveLength(1)
    const text = (ai.analyzeCalls[0] as AnalyzeRequest<unknown>).text
    expect(text).toContain('Learner (spoken): I goed home')
    expect(text).toContain('Tutor: You went home!')
    expect(text).not.toContain('status')
  })
  it('a targeted session ended with no user turns leaves its mistakes unchanged', async () => {
    insertConversation(db, conv({ mode: 'targeted', turnCount: 0 }))
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'x',
        improved: 'y',
        explanationZh: 'z',
        category: 'grammar'
      },
      addDays(NOW, -3),
      M
    )
    const before = getMistakesByIds(db, [M])[0]
    insertPracticeSession(db, C, 'targeted', NOW, [M])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    await new LearningService({ db, ai, now: () => NOW }).endConversation(C)
    expect(getMistakesByIds(db, [M])[0]).toEqual(before)
    expect(getPracticeSession(db, C)).toMatchObject({ endedAt: NOW, reviewsApplied: false })
  })
  it('does not summarize short sessions and stays silent on failure', async () => {
    insertConversation(db, conv({ turnCount: 2 }))
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    await new LearningService({ db, ai, now: () => NOW }).endConversation(C)
    expect(ai.analyzeCalls).toHaveLength(0)

    const db2 = openDatabase(':memory:')
    insertConversation(db2, conv())
    insertPracticeSession(db2, C, 'free', NOW, [])
    const failing = new FakeAIProvider({ failWith: 'network' })
    await expect(
      new LearningService({ db: db2, ai: failing, now: () => NOW }).endConversation(C)
    ).resolves.toBeUndefined()
    expect(getPracticeSession(db2, C)?.summary).toBeNull()
  })
  it('concurrent summarize calls run once', async () => {
    insertConversation(db, conv())
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await Promise.all([svc.summarize(C), svc.summarize(C)])
    expect(ai.analyzeCalls).toHaveLength(1)
  })
})

describe('LearningService.sweepPendingSummaries', () => {
  it('closes stale sessions and summarizes them', async () => {
    insertConversation(db, conv({ updatedAt: addDays(NOW, -1) }))
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    await new LearningService({ db, ai, now: () => NOW }).sweepPendingSummaries()
    expect(getPracticeSession(db, C)).toMatchObject({ endedAt: addDays(NOW, -1), summary })
  })
})

describe('LearningService.analyzeProfile / maybeAutoAnalyze', () => {
  it('refuses without data and does not call Claude', async () => {
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const r = await new LearningService({ db, ai, now: () => NOW }).analyzeProfile()
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('还没有足够的练习数据') })
    expect(ai.analyzeCalls).toHaveLength(0)
  })
  it('saves the profile and the timestamp', async () => {
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'a',
        improved: 'b',
        explanationZh: 'c',
        category: 'grammar'
      },
      NOW,
      M
    )
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const r = await new LearningService({ db, ai, now: () => NOW }).analyzeProfile()
    expect(r).toEqual({ ok: true, profile: { ...profileOut, updatedAt: NOW } })
    expect(getProfile(db)).toEqual({ ...profileOut, updatedAt: NOW })
    expect(getSettings(db).lastProfileAnalysisAt).toBe(NOW)
    expect((ai.analyzeCalls[0] as AnalyzeRequest<unknown>).text).toContain('a → b')
  })
  it('maps failures to ok:false', async () => {
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'a',
        improved: 'b',
        explanationZh: 'c',
        category: 'grammar'
      },
      NOW,
      M
    )
    const r = await new LearningService({
      db,
      ai: new FakeAIProvider({ failWith: 'network' }),
      now: () => NOW
    }).analyzeProfile()
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('分析失败') })
  })
  it('auto-analyzes only after 24 h and only with new data', async () => {
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(0)
    insertMistake(
      db,
      {
        conversationId: null,
        messageId: null,
        original: 'a',
        improved: 'b',
        explanationZh: 'c',
        category: 'grammar'
      },
      addDays(NOW, -0.1),
      M
    )
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -0.5) })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(0)
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -2) })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(1)
    // 只有新小结（没有新错句）也算新数据
    // last 晚于那条错句（NOW - 0.1）、早于小结的 ended_at（NOW），才能单独验证「仅新小结」
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -0.05) })
    insertConversation(db, conv())
    insertPracticeSession(db, C, 'free', addDays(NOW, -1), [])
    markSessionEnded(db, C, NOW)
    saveSessionSummary(db, C, summary)
    const later = new LearningService({ db, ai, now: () => addDays(NOW, 1.5) })
    await later.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(2)
  })
  it('stats and profile pass through', () => {
    saveProfile(db, { ...profileOut, level: 'B1', updatedAt: NOW })
    const svc = new LearningService({ db, ai: new FakeAIProvider(), now: () => NOW })
    expect(svc.profile()?.level).toBe('B1')
    expect(svc.stats().sessions).toBe(0)
  })
})

describe('buildSummaryInput', () => {
  it('formats transcript lines and corrections', () => {
    const text = buildSummaryInput(
      [
        {
          id: 'u',
          conversationId: C,
          role: 'user',
          content: 'hi',
          structured: null,
          status: 'done',
          fromAsr: false,
          createdAt: NOW
        }
      ],
      [
        {
          id: M,
          conversationId: C,
          messageId: null,
          original: 'a',
          improved: 'b',
          explanationZh: 'c',
          category: 'grammar',
          reviewCount: 0,
          nextReviewAt: NOW,
          status: 'pending',
          createdAt: NOW
        }
      ]
    )
    expect(text).toContain('Learner: hi')
    expect(text).toContain('a → b (grammar)')
  })
})
