import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../db/index'
import { FakeAIProvider } from '../ai/fake'
import { LessonService } from './service'
import { listVocab } from '../db/vocabulary'

let db: Db
let dir: string
const extraction = {
  title: 'Lesson 5',
  body: 'Good morning.',
  vocabulary: [{ word: 'morning', meaningZh: '早上', example: 'Good morning.' }],
  notesZh: '问候语。'
}

beforeEach(() => {
  db = openDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'my-tutor-lessons-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('extract', () => {
  it('sends images to analyze with the extraction prompt', async () => {
    const ai = new FakeAIProvider({ analyzeResult: extraction })
    const svc = new LessonService({ db, ai, lessonsDir: dir })
    const r = await svc.extract({ images: [{ mime: 'image/png', base64: 'QUJD' }] })
    expect(r.title).toBe('Lesson 5')
    expect(ai.analyzeCalls[0].systemPrompt).toContain('vocabulary')
    expect(ai.analyzeCalls[0].images).toHaveLength(1)
    expect(ai.analyzeCalls[0].text).toMatch(/image/)
  })
  it('sends pasted text inline', async () => {
    const ai = new FakeAIProvider({ analyzeResult: extraction })
    const svc = new LessonService({ db, ai, lessonsDir: dir })
    await svc.extract({ text: 'Hi team, quick reminder.' })
    expect(ai.analyzeCalls[0].text).toContain('Hi team, quick reminder.')
    expect(ai.analyzeCalls[0].images).toBeUndefined()
  })
})

describe('save / list / delete', () => {
  it('saving a lesson adds its vocabulary to the vocabulary book', () => {
    const svc = new LessonService({ db, ai: new FakeAIProvider(), lessonsDir: dir })
    const lesson = svc.save({ ...extraction, source: 'text' })
    expect(listVocab(db, '')).toMatchObject([
      { word: 'morning', source: 'lesson', sourceId: lesson.id }
    ])
  })
  it('writes image files, stores assets, lists newest first, deletes files', async () => {
    const ids = ['l1', 'a0', 'a1', 'v0']
    const svc = new LessonService({
      db,
      ai: new FakeAIProvider(),
      lessonsDir: dir,
      uuid: () => ids.shift()!
    })
    const png = Buffer.from('fake-png').toString('base64')
    const lesson = svc.save({
      ...extraction,
      source: 'image',
      images: [
        { mime: 'image/png', base64: png },
        { mime: 'image/jpeg', base64: png }
      ]
    })
    expect(lesson.id).toBe('l1')
    expect(lesson.assets.map((a) => a.path)).toEqual([
      join(dir, 'l1', '0.png'),
      join(dir, 'l1', '1.jpg')
    ])
    expect(readFileSync(lesson.assets[0].path, 'utf8')).toBe('fake-png')
    expect(lesson.assets[0].size).toBe(8)
    expect(svc.list()[0].id).toBe('l1')
    await svc.delete('l1')
    expect(svc.list()).toEqual([])
    expect(existsSync(join(dir, 'l1'))).toBe(false)
  })
  it('text lessons have no assets', () => {
    const svc = new LessonService({ db, ai: new FakeAIProvider(), lessonsDir: dir })
    const lesson = svc.save({ ...extraction, source: 'text' })
    expect(lesson.assets).toEqual([])
    expect(lesson.vocabulary).toHaveLength(1)
  })
})
