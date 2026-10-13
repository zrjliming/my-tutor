import type { CorrectionCategory, Mistake, MistakeFilter } from '@shared/types'
import type { Db } from './index'
import { firstReviewAt, nextReviewAfter } from '../learning/review'

export interface NewMistake {
  conversationId: string | null
  messageId: string | null
  original: string
  improved: string
  explanationZh: string
  category: CorrectionCategory
}

interface Row {
  id: string
  conversation_id: string | null
  message_id: string | null
  original: string
  improved: string
  explanation_zh: string
  category: string
  review_count: number
  next_review_at: string
  status: string
  created_at: string
}

const toMistake = (r: Row): Mistake => ({
  id: r.id,
  conversationId: r.conversation_id,
  messageId: r.message_id,
  original: r.original,
  improved: r.improved,
  explanationZh: r.explanation_zh,
  category: r.category as CorrectionCategory,
  reviewCount: r.review_count,
  nextReviewAt: r.next_review_at,
  status: r.status as Mistake['status'],
  createdAt: r.created_at
})

const rows = (db: Db, sql: string, ...params: Array<string | number>): Mistake[] =>
  (db.prepare(sql).all(...params) as unknown as Row[]).map(toMistake)

export function insertMistake(db: Db, m: NewMistake, now: string, id: string): boolean {
  if (m.conversationId) {
    const dup = db
      .prepare(
        `SELECT 1 FROM mistakes WHERE conversation_id = ? AND original = ? AND improved = ? AND status = 'pending'`
      )
      .get(m.conversationId, m.original, m.improved)
    if (dup) return false
  }
  db.prepare(
    `INSERT INTO mistakes (id, conversation_id, message_id, original, improved, explanation_zh, category, review_count, next_review_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)`
  ).run(
    id,
    m.conversationId,
    m.messageId,
    m.original,
    m.improved,
    m.explanationZh,
    m.category,
    firstReviewAt(now),
    now
  )
  return true
}

export function listMistakes(db: Db, filter: MistakeFilter, now: string): Mistake[] {
  if (filter === 'mastered') {
    return rows(db, `SELECT * FROM mistakes WHERE status = 'mastered' ORDER BY created_at DESC`)
  }
  if (filter === 'due') {
    return rows(
      db,
      `SELECT * FROM mistakes WHERE status = 'pending' AND next_review_at <= ? ORDER BY next_review_at ASC`,
      now
    )
  }
  if (filter === 'all') {
    return rows(
      db,
      `SELECT * FROM mistakes WHERE status = 'pending' ORDER BY next_review_at ASC, created_at DESC`
    )
  }
  return rows(
    db,
    `SELECT * FROM mistakes WHERE status = 'pending' AND category = ? ORDER BY next_review_at ASC, created_at DESC`,
    filter
  )
}

export function dueMistakes(db: Db, now: string, limit: number): Mistake[] {
  return rows(
    db,
    `SELECT * FROM mistakes WHERE status = 'pending' AND next_review_at <= ? ORDER BY next_review_at ASC LIMIT ?`,
    now,
    limit
  )
}

export function getMistakesByIds(db: Db, ids: string[]): Mistake[] {
  if (ids.length === 0) return []
  const found = rows(
    db,
    `SELECT * FROM mistakes WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids
  )
  const byId = new Map(found.map((m) => [m.id, m]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export function markMistakeReviewed(db: Db, id: string, now: string): void {
  const row = db
    .prepare(`SELECT review_count FROM mistakes WHERE id = ? AND status = 'pending'`)
    .get(id) as { review_count: number } | undefined
  if (!row) return
  const count = row.review_count + 1
  db.prepare('UPDATE mistakes SET review_count = ?, next_review_at = ? WHERE id = ?').run(
    count,
    nextReviewAfter(count, now),
    id
  )
}

export function setMistakeMastered(db: Db, id: string): void {
  db.prepare(`UPDATE mistakes SET status = 'mastered' WHERE id = ?`).run(id)
}

export function deleteMistake(db: Db, id: string): void {
  db.prepare('DELETE FROM mistakes WHERE id = ?').run(id)
}

export function mistakesForConversation(db: Db, conversationId: string): Mistake[] {
  return rows(
    db,
    'SELECT * FROM mistakes WHERE conversation_id = ? ORDER BY created_at ASC',
    conversationId
  )
}

export function recentMistakes(db: Db, sinceIso: string): Mistake[] {
  return rows(db, 'SELECT * FROM mistakes WHERE created_at >= ? ORDER BY created_at DESC', sinceIso)
}
