import type { Message, MessageStatus, TutorResponse } from '@shared/types'
import type { Db } from './index'

interface Row {
  id: string
  conversation_id: string
  role: string
  content: string
  structured_json: string | null
  status: string
  from_asr: number
  created_at: string
}

const toMessage = (r: Row): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role as Message['role'],
  content: r.content,
  structured: r.structured_json ? (JSON.parse(r.structured_json) as TutorResponse) : null,
  status: r.status as MessageStatus,
  fromAsr: r.from_asr === 1,
  createdAt: r.created_at
})

export function insertMessage(db: Db, m: Message): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, structured_json, status, from_asr, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.id,
    m.conversationId,
    m.role,
    m.content,
    m.structured ? JSON.stringify(m.structured) : null,
    m.status,
    m.fromAsr ? 1 : 0,
    m.createdAt
  )
}

export function updateMessage(
  db: Db,
  id: string,
  patch: { content: string; structured: TutorResponse | null; status: MessageStatus }
): void {
  db.prepare('UPDATE messages SET content = ?, structured_json = ?, status = ? WHERE id = ?').run(
    patch.content,
    patch.structured ? JSON.stringify(patch.structured) : null,
    patch.status,
    id
  )
}

export function listMessages(db: Db, conversationId: string): Message[] {
  return (
    db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC'
      )
      .all(conversationId) as unknown as Row[]
  ).map(toMessage)
}
