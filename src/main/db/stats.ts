import type { CorrectionCategory, LearningStats } from '@shared/types'
import type { Db } from './index'

const count = (db: Db, sql: string, ...params: string[]): number =>
  (db.prepare(sql).get(...params) as { n: number }).n

export function learningStats(db: Db, now: string): LearningStats {
  const byCategory: Record<CorrectionCategory, number> = {
    grammar: 0,
    word_choice: 0,
    naturalness: 0,
    other: 0
  }
  for (const r of db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM mistakes WHERE status = 'pending' GROUP BY category`
    )
    .all() as unknown as { category: CorrectionCategory; n: number }[]) {
    if (r.category in byCategory) byCategory[r.category] = r.n
  }
  const fam = [0, 0, 0, 0, 0, 0]
  for (const r of db
    .prepare('SELECT familiarity AS f, COUNT(*) AS n FROM vocabulary GROUP BY familiarity')
    .all() as unknown as { f: number; n: number }[]) {
    if (r.f >= 0 && r.f <= 5) fam[r.f] = r.n
  }
  return {
    mistakesByCategory: byCategory,
    mistakesPending: count(db, `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'pending'`),
    mistakesDue: count(
      db,
      `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'pending' AND next_review_at <= ?`,
      now
    ),
    mistakesMastered: count(db, `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'mastered'`),
    vocabTotal: count(db, 'SELECT COUNT(*) AS n FROM vocabulary'),
    vocabByFamiliarity: fam,
    sessions: count(db, 'SELECT COUNT(*) AS n FROM practice_sessions'),
    totalTurns: count(db, 'SELECT COALESCE(SUM(turn_count), 0) AS n FROM conversations')
  }
}
