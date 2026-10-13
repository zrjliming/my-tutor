import type { Conversation, Mode } from '@shared/types'
import type { Db } from './index'
import { clearVocabSource } from './vocabulary'

interface Row {
  id: string
  title: string
  mode: string
  lesson_id: string | null
  scenario: string | null
  turn_count: number
  session_started: number
  created_at: string
  updated_at: string
  ended_at: string | null
}

const toConversation = (r: Row): Conversation => ({
  id: r.id,
  title: r.title,
  mode: r.mode as Mode,
  lessonId: r.lesson_id,
  scenario: r.scenario,
  turnCount: r.turn_count,
  sessionStarted: r.session_started === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  endedAt: r.ended_at
})

export function insertConversation(db: Db, c: Conversation): void {
  db.prepare(
    `INSERT INTO conversations (id, title, mode, lesson_id, scenario, turn_count, session_started, created_at, updated_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.id,
    c.title,
    c.mode,
    c.lessonId,
    c.scenario,
    c.turnCount,
    c.sessionStarted ? 1 : 0,
    c.createdAt,
    c.updatedAt,
    c.endedAt
  )
}

export function listConversations(db: Db): Conversation[] {
  return (
    db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as unknown as Row[]
  ).map(toConversation)
}

export function getConversation(db: Db, id: string): Conversation | undefined {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as
    Row | undefined
  return row ? toConversation(row) : undefined
}

export function deleteConversation(db: Db, id: string): void {
  clearVocabSource(db, 'conversation', id)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function markSessionStarted(db: Db, id: string): void {
  db.prepare('UPDATE conversations SET session_started = 1 WHERE id = ?').run(id)
}

export function bumpTurn(db: Db, id: string, now: string): void {
  db.prepare(
    'UPDATE conversations SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?'
  ).run(now, id)
}
