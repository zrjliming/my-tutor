import type { CefrLevel, LearnerProfile } from '@shared/types'
import type { Db } from './index'

interface Row {
  level: string
  weaknesses_json: string
  progress_json: string
  suggestions_json: string
  summary_zh: string
  updated_at: string
}

export function getProfile(db: Db): LearnerProfile | null {
  const r = db.prepare('SELECT * FROM learner_profile WHERE id = 1').get() as unknown as
    Row | undefined
  if (!r) return null
  return {
    level: r.level as CefrLevel,
    weaknesses: JSON.parse(r.weaknesses_json) as string[],
    progress: JSON.parse(r.progress_json) as string[],
    suggestions: JSON.parse(r.suggestions_json) as string[],
    summaryZh: r.summary_zh,
    updatedAt: r.updated_at
  }
}

export function saveProfile(db: Db, p: LearnerProfile): void {
  db.prepare(
    `INSERT INTO learner_profile (id, level, weaknesses_json, progress_json, suggestions_json, summary_zh, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET level = excluded.level, weaknesses_json = excluded.weaknesses_json,
       progress_json = excluded.progress_json, suggestions_json = excluded.suggestions_json,
       summary_zh = excluded.summary_zh, updated_at = excluded.updated_at`
  ).run(
    p.level,
    JSON.stringify(p.weaknesses),
    JSON.stringify(p.progress),
    JSON.stringify(p.suggestions),
    p.summaryZh,
    p.updatedAt
  )
}
