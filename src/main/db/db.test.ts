import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, migrate, type Db } from './index'
import {
  insertConversation,
  listConversations,
  getConversation,
  deleteConversation,
  markSessionStarted,
  bumpTurn
} from './conversations'
import { insertMessage, updateMessage, listMessages } from './messages'
import { insertLesson, listLessons, getLesson, deleteLesson } from './lessons'
import { getSettings, patchSettings } from './settings'
import type { Conversation, Lesson, Message } from '@shared/types'

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  title: '自由聊天',
  mode: 'free',
  lessonId: null,
  scenario: null,
  turnCount: 0,
  sessionStarted: false,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  endedAt: null,
  ...over
})
const msg = (id: string, conversationId: string, over: Partial<Message> = {}): Message => ({
  id,
  conversationId,
  role: 'user',
  content: 'hi',
  structured: null,
  status: 'done',
  fromAsr: false,
  createdAt: `2026-10-12T00:00:0${id.length % 10}.000Z`,
  ...over
})

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('migrate', () => {
  it('sets user_version and is idempotent', () => {
    expect(migrate(db)).toBe(1)
    expect(migrate(db)).toBe(1)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual([
      'conversations',
      'lesson_assets',
      'lessons',
      'messages',
      'settings'
    ])
  })
})

describe('conversations', () => {
  it('round-trips, orders by updated_at desc, bumps turns and marks session', () => {
    insertConversation(db, conv('a'))
    insertConversation(
      db,
      conv('b', {
        updatedAt: '2026-10-13T00:00:00.000Z',
        mode: 'lesson',
        lessonId: null,
        scenario: '餐厅'
      })
    )
    expect(listConversations(db).map((c) => c.id)).toEqual(['b', 'a'])
    bumpTurn(db, 'a', '2026-10-14T00:00:00.000Z')
    markSessionStarted(db, 'a')
    const a = getConversation(db, 'a')!
    expect(a.turnCount).toBe(1)
    expect(a.sessionStarted).toBe(true)
    expect(a.updatedAt).toBe('2026-10-14T00:00:00.000Z')
    expect(listConversations(db)[0].id).toBe('a')
    expect(getConversation(db, 'zzz')).toBeUndefined()
  })
  it('delete cascades to messages', () => {
    insertConversation(db, conv('a'))
    insertMessage(db, msg('m1', 'a'))
    deleteConversation(db, 'a')
    expect(listMessages(db, 'a')).toEqual([])
    expect(getConversation(db, 'a')).toBeUndefined()
  })
})

describe('messages', () => {
  it('stores structured json and updates status/content', () => {
    insertConversation(db, conv('a'))
    insertMessage(db, msg('m1', 'a', { fromAsr: true }))
    insertMessage(db, msg('m2', 'a', { role: 'assistant', content: '', status: 'streaming' }))
    updateMessage(db, 'm2', { content: 'Hello!', structured: { reply: 'Hello!' }, status: 'done' })
    const list = listMessages(db, 'a')
    expect(list.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(list[0].fromAsr).toBe(true)
    expect(list[1]).toMatchObject({
      content: 'Hello!',
      status: 'done',
      structured: { reply: 'Hello!' }
    })
  })
})

describe('lessons', () => {
  const lesson: Lesson = {
    id: 'l1',
    title: 'Lesson 5',
    body: 'Good morning.',
    source: 'image',
    notesZh: '问候',
    createdAt: '2026-10-12T00:00:00.000Z',
    vocabulary: [{ word: 'morning', meaningZh: '早上', example: 'Good morning.' }],
    assets: [{ id: 'as1', lessonId: 'l1', path: '/x/l1/0.jpg', mime: 'image/jpeg', size: 123 }]
  }
  it('round-trips with assets and vocabulary', () => {
    insertLesson(db, lesson)
    expect(getLesson(db, 'l1')).toEqual(lesson)
    expect(listLessons(db)).toHaveLength(1)
    deleteLesson(db, 'l1')
    expect(getLesson(db, 'l1')).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) AS n FROM lesson_assets').get() as { n: number }).n).toBe(0)
  })
})

describe('settings', () => {
  it('returns defaults, persists patches, keeps types', () => {
    expect(getSettings(db).difficulty).toBe('intermediate')
    const s = patchSettings(db, { difficulty: 'beginner', autoSpeak: false, rate: 160 })
    expect(s).toMatchObject({
      difficulty: 'beginner',
      autoSpeak: false,
      rate: 160,
      voice: 'Samantha'
    })
    expect(getSettings(db).autoSpeak).toBe(false)
  })
})
