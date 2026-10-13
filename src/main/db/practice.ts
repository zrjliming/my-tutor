import type { Mode, SessionSummary } from '@shared/types'
import type { Db } from './index'

export interface PracticeSession {
  conversationId: string
  mode: Mode
  startedAt: string
  endedAt: string | null
  summary: SessionSummary | null
  reviewedMistakeIds: string[]
  reviewsApplied: boolean
}

interface Row {
  conversation_id: string
  mode: string
  started_at: string
  ended_at: string | null
  summary_json: string | null
  reviewed_mistake_ids: string
  reviews_applied: number
}

const toSession = (r: Row): PracticeSession => ({
  conversationId: r.conversation_id,
  mode: r.mode as Mode,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  summary: r.summary_json ? (JSON.parse(r.summary_json) as SessionSummary) : null,
  reviewedMistakeIds: JSON.parse(r.reviewed_mistake_ids) as string[],
  reviewsApplied: r.reviews_applied === 1
})

export function insertPracticeSession(
  db: Db,
  conversationId: string,
  mode: Mode,
  startedAt: string,
  reviewedMistakeIds: string[]
): void {
  db.prepare(
    `INSERT OR IGNORE INTO practice_sessions (conversation_id, mode, started_at, reviewed_mistake_ids) VALUES (?, ?, ?, ?)`
  ).run(conversationId, mode, startedAt, JSON.stringify(reviewedMistakeIds))
}

export function getPracticeSession(db: Db, conversationId: string): PracticeSession | undefined {
  const row = db
    .prepare('SELECT * FROM practice_sessions WHERE conversation_id = ?')
    .get(conversationId) as unknown as Row | undefined
  return row ? toSession(row) : undefined
}

export function markSessionEnded(db: Db, conversationId: string, endedAt: string): void {
  db.prepare(
    'UPDATE practice_sessions SET ended_at = ? WHERE conversation_id = ? AND ended_at IS NULL'
  ).run(endedAt, conversationId)
}

export function markReviewsApplied(db: Db, conversationId: string): void {
  db.prepare('UPDATE practice_sessions SET reviews_applied = 1 WHERE conversation_id = ?').run(
    conversationId
  )
}

export function saveSessionSummary(db: Db, conversationId: string, summary: SessionSummary): void {
  db.prepare('UPDATE practice_sessions SET summary_json = ? WHERE conversation_id = ?').run(
    JSON.stringify(summary),
    conversationId
  )
}

export function sessionsNeedingSummary(db: Db, minTurns: number, limit: number): string[] {
  return (
    db
      .prepare(
        `SELECT p.conversation_id AS id FROM practice_sessions p JOIN conversations c ON c.id = p.conversation_id
       WHERE p.ended_at IS NOT NULL AND p.summary_json IS NULL AND c.turn_count >= ?
       ORDER BY p.ended_at DESC LIMIT ?`
      )
      .all(minTurns, limit) as unknown as { id: string }[]
  ).map((r) => r.id)
}

export function recentSummaries(
  db: Db,
  limit: number
): Array<{ conversationId: string; endedAt: string | null; summary: SessionSummary }> {
  return (
    db
      .prepare(
        `SELECT conversation_id, ended_at, summary_json FROM practice_sessions WHERE summary_json IS NOT NULL ORDER BY ended_at DESC LIMIT ?`
      )
      .all(limit) as unknown as {
      conversation_id: string
      ended_at: string | null
      summary_json: string
    }[]
  ).map((r) => ({
    conversationId: r.conversation_id,
    endedAt: r.ended_at,
    summary: JSON.parse(r.summary_json) as SessionSummary
  }))
}

export function summariesSince(db: Db, sinceIso: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM practice_sessions WHERE summary_json IS NOT NULL AND ended_at >= ?'
    )
    .get(sinceIso) as { n: number }
  return row.n
}
