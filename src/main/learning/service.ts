import type {
  AnalyzeOutcome,
  LearnerProfile,
  LearningStats,
  Message,
  Mistake,
  SessionSummary
} from '@shared/types'
import { LearnerProfileOutputSchema, SessionSummarySchema } from '@shared/schemas'
import type { AIProvider } from '../ai/types'
import type { Db } from '../db/index'
import { getConversation } from '../db/conversations'
import { listMessages } from '../db/messages'
import { markMistakeReviewed, mistakesForConversation, recentMistakes } from '../db/mistakes'
import {
  closeStaleSessions,
  getPracticeSession,
  markReviewsApplied,
  markSessionEnded,
  recentSummaries,
  saveSessionSummary,
  sessionsNeedingSummary,
  summariesSince
} from '../db/practice'
import { getProfile, saveProfile } from '../db/profile'
import { getSettings, patchSettings } from '../db/settings'
import { learningStats } from '../db/stats'
import { ANALYZE_LEARNER_PROMPT, SUMMARIZE_SESSION_PROMPT } from './prompts'
import { addDays } from './review'

export const SUMMARY_MIN_TURNS = 3
const TRANSCRIPT_LIMIT = 20
const PROFILE_WINDOW_DAYS = 30
const AUTO_ANALYZE_INTERVAL_MS = 24 * 60 * 60 * 1000
const NO_DATA_MESSAGE = '还没有足够的练习数据：先在聊天里练几轮，再来更新分析。'

export interface LearningServiceDeps {
  db: Db
  ai: AIProvider
  now?: () => string
}

export function buildSummaryInput(messages: Message[], mistakes: Mistake[]): string {
  const lines = messages
    .filter((m) => m.status === 'done' && m.content.trim() !== '')
    .slice(-TRANSCRIPT_LIMIT)
    .map((m) => {
      const who = m.role === 'assistant' ? 'Tutor' : m.fromAsr ? 'Learner (spoken)' : 'Learner'
      return `${who}: ${m.content}`
    })
  const out = ['Transcript:', ...lines, '']
  if (mistakes.length === 0) {
    out.push('Corrections recorded: none')
  } else {
    out.push('Corrections recorded:')
    for (const m of mistakes) out.push(`- ${m.original} → ${m.improved} (${m.category})`)
  }
  return out.join('\n')
}

export function buildProfileInput(args: {
  mistakes: Mistake[]
  stats: LearningStats
  summaries: SessionSummary[]
  previous: LearnerProfile | null
}): string {
  const out: string[] = ['Corrections (last 30 days):']
  const byCategory = new Map<string, Mistake[]>()
  for (const m of args.mistakes) {
    const list = byCategory.get(m.category) ?? []
    list.push(m)
    byCategory.set(m.category, list)
  }
  if (byCategory.size === 0) out.push('None')
  for (const [category, list] of byCategory) {
    out.push(`${category}: ${list.length}`)
    for (const m of list.slice(0, 5)) out.push(`- ${m.original} → ${m.improved}`)
  }
  out.push('', 'Vocabulary:')
  out.push(`Total words: ${args.stats.vocabTotal}`)
  out.push(`By familiarity (0-5): ${args.stats.vocabByFamiliarity.join(', ')}`)
  out.push('', 'Recent session summaries:')
  if (args.summaries.length === 0) out.push('None')
  for (const s of args.summaries) {
    out.push(`- Practiced: ${s.practiced}`)
    out.push(`  Performance: ${s.performanceZh}`)
    out.push(`  Issues: ${s.issues.length > 0 ? s.issues.join('; ') : 'none'}`)
  }
  out.push('', 'Previous assessment:')
  if (args.previous) {
    out.push(`Level: ${args.previous.level}`)
    out.push(`Weaknesses: ${args.previous.weaknesses.join('; ') || 'none'}`)
    out.push(`Summary: ${args.previous.summaryZh}`)
  } else {
    out.push('None')
  }
  return out.join('\n')
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class LearningService {
  private readonly db: Db
  private readonly ai: AIProvider
  private readonly now: () => string
  private readonly summarizing = new Map<string, Promise<void>>()

  constructor(deps: LearningServiceDeps) {
    this.db = deps.db
    this.ai = deps.ai
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  private model(): string | undefined {
    return getSettings(this.db).model || undefined
  }

  async endConversation(conversationId: string): Promise<void> {
    try {
      const conv = getConversation(this.db, conversationId)
      if (!conv) return
      const now = this.now()
      markSessionEnded(this.db, conversationId, now)
      const session = getPracticeSession(this.db, conversationId)
      if (session && !session.reviewsApplied && session.reviewedMistakeIds.length > 0) {
        for (const id of session.reviewedMistakeIds) markMistakeReviewed(this.db, id, now)
        markReviewsApplied(this.db, conversationId)
      }
      if (session && conv.turnCount >= SUMMARY_MIN_TURNS && !session.summary) {
        await this.summarize(conversationId)
      }
    } catch (e) {
      console.warn('[my-tutor] endConversation failed', e)
    }
  }

  summarize(conversationId: string): Promise<void> {
    const running = this.summarizing.get(conversationId)
    if (running) return running
    const p = this.runSummarize(conversationId).finally(() => {
      this.summarizing.delete(conversationId)
    })
    this.summarizing.set(conversationId, p)
    return p
  }

  private async runSummarize(conversationId: string): Promise<void> {
    try {
      const text = buildSummaryInput(
        listMessages(this.db, conversationId),
        mistakesForConversation(this.db, conversationId)
      )
      const summary = await this.ai.analyze({
        systemPrompt: SUMMARIZE_SESSION_PROMPT,
        text,
        schema: SessionSummarySchema,
        model: this.model()
      })
      saveSessionSummary(this.db, conversationId, summary)
    } catch (e) {
      console.warn('[my-tutor] summarize failed', e)
    }
  }

  async sweepPendingSummaries(limit = 3): Promise<void> {
    try {
      closeStaleSessions(this.db)
      for (const id of sessionsNeedingSummary(this.db, SUMMARY_MIN_TURNS, limit)) {
        await this.summarize(id)
      }
    } catch (e) {
      console.warn('[my-tutor] sweepPendingSummaries failed', e)
    }
  }

  async analyzeProfile(): Promise<AnalyzeOutcome> {
    try {
      const now = this.now()
      const mistakes = recentMistakes(this.db, addDays(now, -PROFILE_WINDOW_DAYS))
      const summaries = recentSummaries(this.db, 10).map((s) => s.summary)
      if (mistakes.length === 0 && summaries.length === 0) {
        return { ok: false, message: NO_DATA_MESSAGE }
      }
      const text = buildProfileInput({
        mistakes,
        stats: learningStats(this.db, now),
        summaries,
        previous: getProfile(this.db)
      })
      const result = await this.ai.analyze({
        systemPrompt: ANALYZE_LEARNER_PROMPT,
        text,
        schema: LearnerProfileOutputSchema,
        model: this.model()
      })
      const profile: LearnerProfile = { ...result, updatedAt: now }
      saveProfile(this.db, profile)
      patchSettings(this.db, { lastProfileAnalysisAt: now })
      return { ok: true, profile }
    } catch (e) {
      console.warn('[my-tutor] analyzeProfile failed', e)
      return { ok: false, message: '分析失败：' + errorMessage(e) }
    }
  }

  async maybeAutoAnalyze(): Promise<void> {
    try {
      const last = getSettings(this.db).lastProfileAnalysisAt
      if (
        last &&
        new Date(this.now()).getTime() - new Date(last).getTime() < AUTO_ANALYZE_INTERVAL_MS
      ) {
        return
      }
      const since = last ?? '1970-01-01T00:00:00.000Z'
      if (recentMistakes(this.db, since).length === 0 && summariesSince(this.db, since) === 0) {
        return
      }
      await this.analyzeProfile()
    } catch (e) {
      console.warn('[my-tutor] maybeAutoAnalyze failed', e)
    }
  }

  stats(): LearningStats {
    return learningStats(this.db, this.now())
  }

  profile(): LearnerProfile | null {
    return getProfile(this.db)
  }
}
