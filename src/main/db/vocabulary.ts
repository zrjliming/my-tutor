import type { VocabEntry } from '@shared/types'
import type { Db } from './index'
import { firstReviewAt } from '../learning/review'

export interface NewVocab {
  word: string
  meaningZh: string
  example: string
  source: 'conversation' | 'lesson'
  sourceId: string | null
}

interface Row {
  id: string
  word: string
  meaning_zh: string
  example: string
  source: string
  source_id: string | null
  seen_count: number
  familiarity: number
  next_review_at: string
  created_at: string
}

const toVocab = (r: Row): VocabEntry => ({
  id: r.id,
  word: r.word,
  meaningZh: r.meaning_zh,
  example: r.example,
  source: r.source as VocabEntry['source'],
  sourceId: r.source_id,
  seenCount: r.seen_count,
  familiarity: r.familiarity,
  nextReviewAt: r.next_review_at,
  createdAt: r.created_at
})

export function upsertVocab(db: Db, v: NewVocab, now: string, id: string): void {
  const word = v.word.trim()
  if (!word) return
  db.prepare(
    `INSERT INTO vocabulary (id, word, meaning_zh, example, source, source_id, seen_count, familiarity, next_review_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
     ON CONFLICT(word) DO UPDATE SET seen_count = seen_count + 1`
  ).run(id, word, v.meaningZh, v.example, v.source, v.sourceId, firstReviewAt(now), now)
}

export function listVocab(db: Db, search: string): VocabEntry[] {
  const q = search.trim()
  const sql = q
    ? `SELECT * FROM vocabulary WHERE word LIKE ? ESCAPE '\\' OR meaning_zh LIKE ? ESCAPE '\\' ORDER BY familiarity ASC, created_at DESC`
    : 'SELECT * FROM vocabulary ORDER BY familiarity ASC, created_at DESC'
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const list = (q ? db.prepare(sql).all(like, like) : db.prepare(sql).all()) as unknown as Row[]
  return list.map(toVocab)
}

export function setVocabFamiliarity(db: Db, id: string, familiarity: number): void {
  db.prepare('UPDATE vocabulary SET familiarity = ? WHERE id = ?').run(familiarity, id)
}

export function deleteVocab(db: Db, id: string): void {
  db.prepare('DELETE FROM vocabulary WHERE id = ?').run(id)
}

export function clearVocabSource(
  db: Db,
  source: 'conversation' | 'lesson',
  sourceId: string
): void {
  db.prepare('UPDATE vocabulary SET source_id = NULL WHERE source = ? AND source_id = ?').run(
    source,
    sourceId
  )
}
