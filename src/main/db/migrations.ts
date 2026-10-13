export const MIGRATIONS: string[] = [
  `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  lesson_id TEXT,
  scenario TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  session_started INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  structured_json TEXT,
  status TEXT NOT NULL,
  from_asr INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  notes_zh TEXT NOT NULL DEFAULT '',
  vocab_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE lesson_assets (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  `
CREATE TABLE mistakes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  original TEXT NOT NULL,
  improved TEXT NOT NULL,
  explanation_zh TEXT NOT NULL,
  category TEXT NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mistakes_due ON mistakes(status, next_review_at);
CREATE TABLE vocabulary (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL UNIQUE COLLATE NOCASE,
  meaning_zh TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_id TEXT,
  seen_count INTEGER NOT NULL DEFAULT 1,
  familiarity INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE practice_sessions (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary_json TEXT,
  reviewed_mistake_ids TEXT NOT NULL DEFAULT '[]',
  reviews_applied INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE learner_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  level TEXT NOT NULL,
  weaknesses_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO practice_sessions (conversation_id, mode, started_at)
  SELECT id, mode, created_at FROM conversations;
`
]
