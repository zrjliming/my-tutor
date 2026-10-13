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

/** 已结束的会话被继续：重新打开，下次离开时重新生成小结（reviews_applied 不动，复习不会重复推进） */
export function reopenSession(db: Db, conversationId: string): void {
  db.prepare(
    'UPDATE practice_sessions SET ended_at = NULL, summary_json = NULL WHERE conversation_id = ?'
  ).run(conversationId)
}

export function markReviewsApplied(db: Db, conversationId: string): void {
  db.prepare('UPDATE practice_sessions SET reviews_applied = 1 WHERE conversation_id = ?').run(
    conversationId
  )
}

/** 只写给仍处于"已结束"的会话：生成期间用户回来续聊（reopenSession）时丢弃这份过时小结，下次离开重新生成 */
export function saveSessionSummary(db: Db, conversationId: string, summary: SessionSummary): void {
  db.prepare(
    'UPDATE practice_sessions SET summary_json = ? WHERE conversation_id = ? AND ended_at IS NOT NULL'
  ).run(JSON.stringify(summary), conversationId)
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

/** 关闭所有未结束的练习记录（包括正在进行的），只能在应用启动时经 sweepPendingSummaries 调用。 */
export function closeStaleSessions(db: Db): void {
  db.prepare(
    `UPDATE practice_sessions SET ended_at = (SELECT updated_at FROM conversations c WHERE c.id = practice_sessions.conversation_id)
     WHERE ended_at IS NULL`
  ).run()
}
