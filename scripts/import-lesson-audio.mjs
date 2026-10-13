// 把《新概念英语》第 1 册逐句切分的 mp3 + lrc 导入为课文逐句音频（lesson_sentences）。
// 用法：node scripts/import-lesson-audio.mjs <db 路径> <音频根目录> <userData/lessons 目录>
// 音频根目录下是「第001课－…」这样的文件夹，每个里面有 第01句.mp3 / 第01句.lrc …
// 按文件夹编号 N 匹配标题以「Lesson N–」开头的课程；已有句子的课程跳过（可重复执行）。
// 需先用带迁移 3 的应用打开过该数据库（建好 lesson_sentences 表）。
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [dbPath, audioRoot, lessonsDir] = process.argv.slice(2)
if (!dbPath || !audioRoot || !lessonsDir) {
  console.error('用法: node scripts/import-lesson-audio.mjs <db> <audioRoot> <lessonsDir>')
  process.exit(1)
}
for (const p of [dbPath, audioRoot, lessonsDir]) {
  if (!existsSync(p)) {
    console.error(`不存在: ${p}`)
    process.exit(1)
  }
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON')
const hasTable = db
  .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lesson_sentences'`)
  .get()
if (!hasTable) {
  console.error('数据库里没有 lesson_sentences 表：先用新版应用打开一次完成迁移')
  process.exit(1)
}

const byNumber = new Map()
for (const l of db.prepare('SELECT id, title FROM lessons').all()) {
  const m = /^Lesson (\d+)\s*[–-]/.exec(l.title)
  if (m) byNumber.set(Number(m[1]), l)
}

const countSentences = db.prepare('SELECT COUNT(*) AS n FROM lesson_sentences WHERE lesson_id = ?')
const insert = db.prepare(
  'INSERT INTO lesson_sentences (id, lesson_id, idx, text, text_zh, audio_path) VALUES (?, ?, ?, ?, ?, ?)'
)
const summary = { imported: 0, sentences: 0, skippedExisting: 0, noLesson: [], empty: [] }

const folders = readdirSync(audioRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
for (const folder of folders) {
  const m = /^第(\d+)课/.exec(folder)
  if (!m) continue
  const n = Number(m[1])
  const lesson = byNumber.get(n)
  if (!lesson) {
    summary.noLesson.push(folder)
    continue
  }
  if (countSentences.get(lesson.id).n > 0) {
    summary.skippedExisting++
    continue
  }
  const dir = join(audioRoot, folder)
  const items = readdirSync(dir)
    .map((f) => /^第(\d+)句\.mp3$/i.exec(f))
    .filter(Boolean)
    .map((mm) => ({
      idx: Number(mm[1]),
      mp3: join(dir, mm[0]),
      lrc: join(dir, `第${mm[1]}句.lrc`)
    }))
    .sort((a, b) => a.idx - b.idx)
  if (!items.length) {
    summary.empty.push(folder)
    continue
  }
  const audioDir = join(lessonsDir, lesson.id, 'audio')
  mkdirSync(audioDir, { recursive: true })
  const rows = items.map((it) => {
    const dest = join(audioDir, `${String(it.idx).padStart(2, '0')}.mp3`)
    copyFileSync(it.mp3, dest)
    let text = ''
    let textZh = ''
    if (existsSync(it.lrc)) {
      const buf = readFileSync(it.lrc)
      let raw
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        raw = new TextDecoder('gbk').decode(buf)
      }
      // 取带时间戳的歌词行，去掉 [..] 标签；「英文－中文」按全角「－」拆开，没有中文就留空
      const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
      const timed = lines.filter((l) => /^\[\d+:\d+(?:[.:]\d+)?\]/.test(l))
      const parts = (timed.length ? timed : lines.filter((l) => l.trim() && !l.startsWith('[')))
        .map((l) => l.replace(/\[[^\]]*\]/g, ''))
        .map((l) => {
          const k = l.indexOf('－')
          return k < 0 ? [l, ''] : [l.slice(0, k), l.slice(k + 1)]
        })
      ;[text, textZh] = [0, 1].map((i) =>
        parts
          .map((p) => p[i])
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      text = text.replace(/￡/g, '£')
    }
    return { idx: it.idx, text: text || `#${it.idx}`, textZh, dest }
  })
  db.exec('BEGIN')
  try {
    for (const r of rows) insert.run(randomUUID(), lesson.id, r.idx, r.text, r.textZh, r.dest)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  summary.imported++
  summary.sentences += rows.length
  console.log(`${lesson.title}: ${rows.length} 句`)
}
db.close()

console.log(
  `\n导入 ${summary.imported} 课 / ${summary.sentences} 句；已有句子跳过 ${summary.skippedExisting} 课`
)
if (summary.noLesson.length) console.log(`找不到对应课程: ${summary.noLesson.join(', ')}`)
if (summary.empty.length) console.log(`没有 mp3: ${summary.empty.join(', ')}`)
