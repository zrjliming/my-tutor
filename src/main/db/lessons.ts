import type { Lesson, LessonAsset } from '@shared/types'
import type { Db } from './index'
import { clearVocabSource } from './vocabulary'

interface LessonRow {
  id: string
  title: string
  body: string
  source: string
  notes_zh: string
  vocab_json: string
  created_at: string
}
interface AssetRow {
  id: string
  lesson_id: string
  path: string
  mime: string
  size: number
}

function assetsFor(db: Db, lessonId: string): LessonAsset[] {
  return (
    db
      .prepare('SELECT * FROM lesson_assets WHERE lesson_id = ? ORDER BY rowid')
      .all(lessonId) as unknown as AssetRow[]
  ).map((a) => ({
    id: a.id,
    lessonId: a.lesson_id,
    path: a.path,
    mime: a.mime,
    size: a.size
  }))
}

const toLesson = (db: Db, r: LessonRow): Lesson => ({
  id: r.id,
  title: r.title,
  body: r.body,
  source: r.source as Lesson['source'],
  notesZh: r.notes_zh,
  vocabulary: JSON.parse(r.vocab_json),
  createdAt: r.created_at,
  assets: assetsFor(db, r.id)
})

export function insertLesson(db: Db, lesson: Lesson): void {
  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO lessons (id, title, body, source, notes_zh, vocab_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      lesson.id,
      lesson.title,
      lesson.body,
      lesson.source,
      lesson.notesZh,
      JSON.stringify(lesson.vocabulary),
      lesson.createdAt
    )
    const ins = db.prepare(
      'INSERT INTO lesson_assets (id, lesson_id, path, mime, size) VALUES (?, ?, ?, ?, ?)'
    )
    for (const a of lesson.assets) ins.run(a.id, lesson.id, a.path, a.mime, a.size)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function listLessons(db: Db): Lesson[] {
  return (
    db.prepare('SELECT * FROM lessons ORDER BY created_at DESC').all() as unknown as LessonRow[]
  ).map((r) => toLesson(db, r))
}

export function getLesson(db: Db, id: string): Lesson | undefined {
  const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as unknown as
    LessonRow | undefined
  return row ? toLesson(db, row) : undefined
}

export function deleteLesson(db: Db, id: string): void {
  clearVocabSource(db, 'lesson', id)
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
}
