# my-tutor M3（阶段 3：学习记录与画像）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每轮对话里的纠错和生词沉淀成错句本、生词本；每段练习自动生成小结；按近期数据生成学习画像（水平、薄弱点、进步、建议），并把画像注入之后的会话；新增"针对性练习"模式，按薄弱点和到期错句出题，练完推进复习进度。

**Architecture:** 数据层新增迁移 2（`mistakes`、`vocabulary`、`practice_sessions`、`learner_profile`）和对应读写函数；`ChatService` 在每轮 `done` 时写错句与生词、在建会话时登记练习记录并为针对性练习选材；新的 `LearningService` 负责会话结束处理（推进复习、生成小结）、画像分析、统计，全部通过已有的 `AIProvider.analyze` 一次性调用完成；渲染进程新增错句本、生词本、学习分析三个页面，并开放针对性练习模式。

**Tech Stack:** 与 M1/M2 相同（electron-vite、Electron 39、React 19、TypeScript、Tailwind 4、zod 4、Vitest、`node:sqlite`、Agent SDK）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-12-speakmate-design.md`（本计划实现第 6 节新表与规则、第 7.2–7.4 节、第 7.1 节针对性练习、第 8.4 节错句本 / 生词本 / 学习分析页、第 12 节阶段 3）。分支从 `dev` 开 `m3`，完成后合回 `dev`。

## Global Constraints

- 复习间隔固定 `REVIEW_INTERVALS_DAYS = [1, 3, 7, 14]`：新错句 `next_review_at = now + 1 天`；每复习一次 `review_count + 1`，下次 = now + `REVIEW_INTERVALS_DAYS[min(review_count, 3)]` 天；"标记已掌握"置 `mastered`，不再出现在到期列表。
- 每轮 `done` 且结构化有效时：`correction` 存在且 `uncertain !== true` → 插入错句（同一会话内 `original`+`improved` 完全相同且仍 pending 的不重复插入）；`vocabulary` 每项 upsert 进生词本（按 `word` 不区分大小写唯一；已存在则 `seen_count + 1`，不覆盖原释义）。开场轮（`OPENING_INSTRUCTION`）不写错句。
- 课程保存时课程生词 upsert（`source = 'lesson'`）。删除会话：错句保留、`conversation_id` / `message_id` 置空，`source='conversation'` 且 `source_id` 为该会话的生词 `source_id` 置空；删除课程：对应 `source='lesson'` 的生词 `source_id` 置空。
- 会话小结：会话"结束"（渲染进程离开该会话 → `conversations:end`；以及应用启动时补跑积压）且 `turn_count >= 3` 且尚无小结时，`analyze` 输入最近 ≤ 20 条消息纯文本 + 本会话错句，输出 `{ practiced, performanceZh, issues[] }`；失败静默，下次再试。**不在退出时调用 Claude**（Ruling：spec 写"应用退出时"，但退出时无法等一次 LLM 调用，改为下次启动补跑，见账本）。
- 学习画像：手动"更新分析"，或启动时距 `lastProfileAnalysisAt` 超过 24 小时且此后有新错句或新小结时自动跑；输入近 30 天错句按类计数与样例（每类 ≤ 5）、生词总数与熟悉度分布、最近 ≤ 10 条小结、上一版画像；输出 `{ level: A1|A2|B1|B2|C1, weaknesses[], progress[], suggestions[], summaryZh }`。
- 画像摘要（level + 前 3 个薄弱点）注入之后**每个新会话**首轮的系统提示（所有模式）。
- 针对性练习选材：薄弱点取前 3；错句取 `status='pending'` 且 `next_review_at <= now` 的前 5 条（按 `next_review_at` 升序）。建会话时选定并记在 `practice_sessions.reviewed_mistake_ids`；会话结束时这些错句各复习一次（推进间隔），只推进一次。
- 所有新 IPC 入参经 zod；所有 `analyze` 调用 `persistSession: false`（provider 已默认）。
- 提交信息中文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；每个任务提交前对改动文件跑 `npx prettier --write` 且 `npx eslint <files>` 0 警告，不禁用规则。
- UI 文案中文。

## Review Focus

1. **同一错误反复出现**：同一会话里同一句错误被纠正两次，错句本只记一条；不同会话再次犯同样的错，再记一条（反映"又犯了"）。测试：Task 4。
2. **针对性练习首轮失败后重试**：选材只在建会话时做一次，首轮失败重试时系统提示里仍是同一批错句；会话结束只推进一次复习。测试：Task 4、Task 5。
3. **没有任何数据时点"更新分析"或开始针对性练习**：画像分析在零错句零小结时给出明确提示而不是调用 Claude；针对性练习在无画像无到期错句时仍可开始（AI 做一般复习）。测试：Task 5、Task 3。
4. **小结生成失败或超时**：静默，`summary_json` 保持空，下次结束 / 启动时再试；同一会话不会并发生成两次。测试：Task 5。
5. **删除会话或课程后**：错句、生词仍在，来源字段为空，页面显示"来源已删除"而不是报错。测试：Task 2、Task 7/8 手动。

---

## 文件结构

```
src/shared/types.ts        + Mistake, VocabEntry, SessionSummary, LearnerProfile, LearningStats, MistakeFilter, REVIEW_INTERVALS_DAYS
src/shared/schemas.ts      + SessionSummarySchema, LearnerProfileOutputSchema, MistakeFilterSchema, VocabSearchSchema, VocabFamiliaritySchema, IdSchema
src/shared/ipc.ts          + mistakes:*, vocab:*, learning:*, conversations:end；SpeakMateAPI 对应方法
src/preload/index.ts       + 对应方法
src/main/db/migrations.ts  + 迁移 2
src/main/db/mistakes.ts    错句读写
src/main/db/vocabulary.ts  生词读写
src/main/db/practice.ts    练习记录读写
src/main/db/profile.ts     画像读写
src/main/db/stats.ts       统计
src/main/db/conversations.ts / lessons.ts  删除时置空生词来源
src/main/learning/review.ts        复习间隔（纯函数）
src/main/learning/prompts.ts       targeted 模式、画像摘要格式化、小结/画像提示词常量
src/main/prompts/targeted-practice.md summarize-session.md analyze-learner.md
src/main/chat/service.ts           写错句/生词、登记练习、针对性选材、画像注入
src/main/lessons/service.ts        课程生词入生词本
src/main/learning/service.ts       LearningService
src/main/ipc/register.ts / index.ts  注册与装配
src/renderer/src/components/Sidebar.tsx / App.tsx  三个新页面入口
src/renderer/src/components/MistakesPage.tsx VocabPage.tsx AnalysisPage.tsx
src/renderer/src/components/ChatPage.tsx           离开会话时通知主进程
src/renderer/src/components/NewConversationDialog.tsx 开放针对性练习
```

依赖与并行波次：`[1] → [2, 3] → [4, 5] → [6] → [7, 8, 9] → [10]`。

---

### Task 1: 共享类型、schema、IPC 与 preload

**Files:**
- Modify: `src/shared/types.ts`、`src/shared/schemas.ts`、`src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/register.test.ts`（通道集合断言暂时排除新通道）
- Test: `src/shared/learning-schemas.test.ts`

**Interfaces:**
- Produces（后续任务按名引用）：

```ts
// types.ts
export type CorrectionCategory = 'grammar' | 'word_choice' | 'naturalness' | 'other'
export interface Mistake {
  id: string; conversationId: string | null; messageId: string | null
  original: string; improved: string; explanationZh: string; category: CorrectionCategory
  reviewCount: number; nextReviewAt: string; status: 'pending' | 'mastered'; createdAt: string
}
export interface VocabEntry {
  id: string; word: string; meaningZh: string; example: string
  source: 'conversation' | 'lesson'; sourceId: string | null
  seenCount: number; familiarity: number; nextReviewAt: string; createdAt: string
}
export interface SessionSummary { practiced: string; performanceZh: string; issues: string[] }
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'
export interface LearnerProfile {
  level: CefrLevel; weaknesses: string[]; progress: string[]; suggestions: string[]; summaryZh: string; updatedAt: string
}
export interface LearningStats {
  mistakesByCategory: Record<CorrectionCategory, number>   // 仅 pending
  mistakesPending: number; mistakesDue: number; mistakesMastered: number
  vocabTotal: number; vocabByFamiliarity: number[]          // 长度 6，下标 = 熟悉度 0..5
  sessions: number; totalTurns: number
}
export type MistakeFilter = 'all' | 'due' | 'mastered' | CorrectionCategory
export type AnalyzeOutcome = { ok: true; profile: LearnerProfile } | { ok: false; message: string }
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14] as const
export const CATEGORY_LABEL: Record<CorrectionCategory, string>   // 语法 / 用词 / 地道程度 / 其他
// schemas.ts
export const SessionSummarySchema, LearnerProfileOutputSchema, MistakeFilterSchema, VocabSearchSchema, VocabFamiliaritySchema, IdSchema
// ipc.ts
IPC.mistakesList, mistakesMaster, mistakesDelete, vocabList, vocabSetFamiliarity, vocabDelete,
    learningStats, learningProfile, learningAnalyze, conversationsEnd
SpeakMateAPI.mistakes: { list(filter: MistakeFilter): Promise<Mistake[]>; master(id): Promise<void>; delete(id): Promise<void> }
SpeakMateAPI.vocab: { list(search: string): Promise<VocabEntry[]>; setFamiliarity(id, familiarity: number): Promise<void>; delete(id): Promise<void> }
SpeakMateAPI.learning: { stats(): Promise<LearningStats>; profile(): Promise<LearnerProfile | null>; analyze(): Promise<AnalyzeOutcome> }
SpeakMateAPI.conversations.end(id: string): Promise<void>
```

- [ ] **Step 1: 写失败的测试 `src/shared/learning-schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  LearnerProfileOutputSchema,
  MistakeFilterSchema,
  SessionSummarySchema,
  VocabFamiliaritySchema,
  VocabSearchSchema
} from './schemas'
import { CATEGORY_LABEL, REVIEW_INTERVALS_DAYS } from './types'

describe('learning schemas', () => {
  it('SessionSummarySchema requires the three fields and caps issues', () => {
    expect(SessionSummarySchema.safeParse({ practiced: '点餐', performanceZh: '不错', issues: ['冠词'] }).success).toBe(true)
    expect(SessionSummarySchema.safeParse({ practiced: '点餐', performanceZh: '不错' }).success).toBe(false)
    expect(SessionSummarySchema.safeParse({ practiced: 'x', performanceZh: 'y', issues: Array(11).fill('a') }).success).toBe(false)
  })
  it('LearnerProfileOutputSchema accepts CEFR levels only', () => {
    const base = { weaknesses: ['冠词'], progress: [], suggestions: ['多练过去式'], summaryZh: '总体 B1' }
    expect(LearnerProfileOutputSchema.safeParse({ ...base, level: 'B1' }).success).toBe(true)
    expect(LearnerProfileOutputSchema.safeParse({ ...base, level: 'C2' }).success).toBe(false)
  })
  it('MistakeFilterSchema accepts views and categories', () => {
    for (const f of ['all', 'due', 'mastered', 'grammar', 'word_choice', 'naturalness', 'other']) {
      expect(MistakeFilterSchema.safeParse(f).success).toBe(true)
    }
    expect(MistakeFilterSchema.safeParse('spelling').success).toBe(false)
  })
  it('VocabFamiliaritySchema bounds familiarity to integers 0..5', () => {
    const id = '7d2f3a4e-1b2c-4d5e-8f90-123456789abc'
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 0 }).success).toBe(true)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 5 }).success).toBe(true)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 6 }).success).toBe(false)
    expect(VocabFamiliaritySchema.safeParse({ id, familiarity: 2.5 }).success).toBe(false)
  })
  it('VocabSearchSchema trims and bounds', () => {
    expect(VocabSearchSchema.parse('  apple ')).toBe('apple')
    expect(VocabSearchSchema.safeParse('a'.repeat(101)).success).toBe(false)
  })
  it('constants', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([1, 3, 7, 14])
    expect(CATEGORY_LABEL.word_choice).toBe('用词')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/learning-schemas.test.ts`
Expected: FAIL（导出不存在）。

- [ ] **Step 3: `src/shared/types.ts` 末尾追加**

```ts
// ---- 学习记录与画像（阶段 3） ----
export type CorrectionCategory = 'grammar' | 'word_choice' | 'naturalness' | 'other'

export const CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  grammar: '语法',
  word_choice: '用词',
  naturalness: '地道程度',
  other: '其他'
}

export interface Mistake {
  id: string
  conversationId: string | null
  messageId: string | null
  original: string
  improved: string
  explanationZh: string
  category: CorrectionCategory
  reviewCount: number
  nextReviewAt: string
  status: 'pending' | 'mastered'
  createdAt: string
}

export interface VocabEntry {
  id: string
  word: string
  meaningZh: string
  example: string
  source: 'conversation' | 'lesson'
  sourceId: string | null
  seenCount: number
  familiarity: number
  nextReviewAt: string
  createdAt: string
}

export interface SessionSummary {
  practiced: string
  performanceZh: string
  issues: string[]
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'

export interface LearnerProfile {
  level: CefrLevel
  weaknesses: string[]
  progress: string[]
  suggestions: string[]
  summaryZh: string
  updatedAt: string
}

export interface LearningStats {
  mistakesByCategory: Record<CorrectionCategory, number>
  mistakesPending: number
  mistakesDue: number
  mistakesMastered: number
  vocabTotal: number
  vocabByFamiliarity: number[]
  sessions: number
  totalTurns: number
}

export type MistakeFilter = 'all' | 'due' | 'mastered' | CorrectionCategory

export type AnalyzeOutcome = { ok: true; profile: LearnerProfile } | { ok: false; message: string }

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14] as const
```

- [ ] **Step 4: `src/shared/schemas.ts` 末尾追加**

```ts
export const IdSchema = z.string().uuid()

export const SessionSummarySchema = z.object({
  practiced: z.string().min(1).max(200),
  performanceZh: z.string().min(1).max(600),
  issues: z.array(z.string().min(1).max(120)).max(10)
})

export const LearnerProfileOutputSchema = z.object({
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
  weaknesses: z.array(z.string().min(1).max(80)).max(8),
  progress: z.array(z.string().min(1).max(120)).max(8),
  suggestions: z.array(z.string().min(1).max(160)).max(8),
  summaryZh: z.string().min(1).max(800)
})

export const MistakeFilterSchema = z.enum([
  'all',
  'due',
  'mastered',
  'grammar',
  'word_choice',
  'naturalness',
  'other'
])

export const VocabSearchSchema = z.string().trim().max(100)

export const VocabFamiliaritySchema = z.object({
  id: z.string().uuid(),
  familiarity: z.number().int().min(0).max(5)
})
```

- [ ] **Step 5: `src/shared/ipc.ts`**

`import type` 加 `AnalyzeOutcome, LearnerProfile, LearningStats, Mistake, MistakeFilter, VocabEntry`。`IPC` 末尾加：

```ts
  conversationsEnd: 'conversations:end',
  mistakesList: 'mistakes:list',
  mistakesMaster: 'mistakes:master',
  mistakesDelete: 'mistakes:delete',
  vocabList: 'vocab:list',
  vocabSetFamiliarity: 'vocab:setFamiliarity',
  vocabDelete: 'vocab:delete',
  learningStats: 'learning:stats',
  learningProfile: 'learning:profile',
  learningAnalyze: 'learning:analyze'
```

`SpeakMateAPI.conversations` 加 `end(id: string): Promise<void>`；末尾加：

```ts
  mistakes: {
    list(filter: MistakeFilter): Promise<Mistake[]>
    master(id: string): Promise<void>
    delete(id: string): Promise<void>
  }
  vocab: {
    list(search: string): Promise<VocabEntry[]>
    setFamiliarity(id: string, familiarity: number): Promise<void>
    delete(id: string): Promise<void>
  }
  learning: {
    stats(): Promise<LearningStats>
    profile(): Promise<LearnerProfile | null>
    analyze(): Promise<AnalyzeOutcome>
  }
```

- [ ] **Step 6: `src/preload/index.ts`**

`conversations` 加 `end: (id) => ipcRenderer.invoke(IPC.conversationsEnd, id)`；末尾加：

```ts
  mistakes: {
    list: (filter) => ipcRenderer.invoke(IPC.mistakesList, filter),
    master: (id) => ipcRenderer.invoke(IPC.mistakesMaster, id),
    delete: (id) => ipcRenderer.invoke(IPC.mistakesDelete, id)
  },
  vocab: {
    list: (search) => ipcRenderer.invoke(IPC.vocabList, search),
    setFamiliarity: (id, familiarity) =>
      ipcRenderer.invoke(IPC.vocabSetFamiliarity, { id, familiarity }),
    delete: (id) => ipcRenderer.invoke(IPC.vocabDelete, id)
  },
  learning: {
    stats: () => ipcRenderer.invoke(IPC.learningStats),
    profile: () => ipcRenderer.invoke(IPC.learningProfile),
    analyze: () => ipcRenderer.invoke(IPC.learningAnalyze)
  }
```

- [ ] **Step 7: 让测试套件保持绿色**

`src/main/ipc/register.test.ts` 的通道集合断言当前要求所有通道都已注册。在期望集合里暂时排除本任务新增的 10 个通道（`conversations:end` 与 `mistakes:` / `vocab:` / `learning:` 前缀），加一行中文注释"阶段 3 Task 6 注册后恢复"。

- [ ] **Step 8: 跑测试、typecheck、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/shared src/preload src/main/ipc/register.test.ts
git commit -m "feat: 阶段 3 共享类型、schema、IPC 与 preload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 数据层：迁移 2、错句 / 生词 / 练习记录 / 画像 / 统计，复习间隔

**Files:**
- Modify: `src/main/db/migrations.ts`、`src/main/db/conversations.ts`、`src/main/db/lessons.ts`
- Create: `src/main/learning/review.ts`、`src/main/db/mistakes.ts`、`src/main/db/vocabulary.ts`、`src/main/db/practice.ts`、`src/main/db/profile.ts`、`src/main/db/stats.ts`
- Test: `src/main/learning/review.test.ts`、`src/main/db/learning-db.test.ts`；修改 `src/main/db/db.test.ts` 的迁移版本断言（1 → 2，表清单加 4 张）

**Interfaces:**
- Consumes：Task 1 类型。
- Produces：

```ts
// learning/review.ts
export function addDays(iso: string, days: number): string
export function firstReviewAt(now: string): string                       // now + 1 天
export function nextReviewAfter(reviewCount: number, now: string): string  // reviewCount 为复习后的新计数
// db/mistakes.ts
export interface NewMistake { conversationId: string | null; messageId: string | null; original: string; improved: string; explanationZh: string; category: CorrectionCategory }
export function insertMistake(db: Db, m: NewMistake, now: string, id: string): boolean   // 同会话重复 pending 返回 false
export function listMistakes(db: Db, filter: MistakeFilter, now: string): Mistake[]
export function dueMistakes(db: Db, now: string, limit: number): Mistake[]
export function getMistakesByIds(db: Db, ids: string[]): Mistake[]       // 保持 ids 顺序，跳过不存在的
export function markMistakeReviewed(db: Db, id: string, now: string): void   // 仅 pending 有效
export function setMistakeMastered(db: Db, id: string): void
export function deleteMistake(db: Db, id: string): void
export function mistakesForConversation(db: Db, conversationId: string): Mistake[]
export function recentMistakes(db: Db, sinceIso: string): Mistake[]
// db/vocabulary.ts
export interface NewVocab { word: string; meaningZh: string; example: string; source: 'conversation' | 'lesson'; sourceId: string | null }
export function upsertVocab(db: Db, v: NewVocab, now: string, id: string): void
export function listVocab(db: Db, search: string): VocabEntry[]           // 熟悉度升序，再按 created_at 倒序
export function setVocabFamiliarity(db: Db, id: string, familiarity: number): void
export function deleteVocab(db: Db, id: string): void
export function clearVocabSource(db: Db, source: 'conversation' | 'lesson', sourceId: string): void
// db/practice.ts
export interface PracticeSession { conversationId: string; mode: Mode; startedAt: string; endedAt: string | null; summary: SessionSummary | null; reviewedMistakeIds: string[]; reviewsApplied: boolean }
export function insertPracticeSession(db: Db, conversationId: string, mode: Mode, startedAt: string, reviewedMistakeIds: string[]): void
export function getPracticeSession(db: Db, conversationId: string): PracticeSession | undefined
export function markSessionEnded(db: Db, conversationId: string, endedAt: string): void   // 只在 endedAt 为空时写
export function markReviewsApplied(db: Db, conversationId: string): void
export function saveSessionSummary(db: Db, conversationId: string, summary: SessionSummary): void
export function sessionsNeedingSummary(db: Db, minTurns: number, limit: number): string[]  // 有 ended_at、turn_count ≥ minTurns、summary 为空
export function recentSummaries(db: Db, limit: number): Array<{ conversationId: string; endedAt: string | null; summary: SessionSummary }>
export function summariesSince(db: Db, sinceIso: string): number
// db/profile.ts
export function getProfile(db: Db): LearnerProfile | null
export function saveProfile(db: Db, p: LearnerProfile): void
// db/stats.ts
export function learningStats(db: Db, now: string): LearningStats
```

- [ ] **Step 1: 写失败的测试 `src/main/learning/review.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { addDays, firstReviewAt, nextReviewAfter } from './review'

const NOW = '2026-10-13T08:00:00.000Z'

describe('review schedule', () => {
  it('adds whole days in UTC', () => {
    expect(addDays(NOW, 1)).toBe('2026-10-14T08:00:00.000Z')
    expect(addDays(NOW, 14)).toBe('2026-10-27T08:00:00.000Z')
  })
  it('first review is one day later', () => {
    expect(firstReviewAt(NOW)).toBe('2026-10-14T08:00:00.000Z')
  })
  it('after the n-th review uses 3 / 7 / 14 / 14 days', () => {
    expect(nextReviewAfter(1, NOW)).toBe(addDays(NOW, 3))
    expect(nextReviewAfter(2, NOW)).toBe(addDays(NOW, 7))
    expect(nextReviewAfter(3, NOW)).toBe(addDays(NOW, 14))
    expect(nextReviewAfter(9, NOW)).toBe(addDays(NOW, 14))
  })
})
```

- [ ] **Step 2: 写失败的测试 `src/main/db/learning-db.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from './index'
import { insertConversation, deleteConversation } from './conversations'
import { insertMessage } from './messages'
import { insertLesson, deleteLesson } from './lessons'
import {
  deleteMistake,
  dueMistakes,
  getMistakesByIds,
  insertMistake,
  listMistakes,
  markMistakeReviewed,
  mistakesForConversation,
  recentMistakes,
  setMistakeMastered
} from './mistakes'
import { clearVocabSource, deleteVocab, listVocab, setVocabFamiliarity, upsertVocab } from './vocabulary'
import {
  getPracticeSession,
  insertPracticeSession,
  markReviewsApplied,
  markSessionEnded,
  recentSummaries,
  saveSessionSummary,
  sessionsNeedingSummary,
  summariesSince
} from './practice'
import { getProfile, saveProfile } from './profile'
import { learningStats } from './stats'
import { addDays } from '../learning/review'
import type { Conversation } from '@shared/types'

const NOW = '2026-10-13T08:00:00.000Z'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, title: 't', mode: 'free', lessonId: null, scenario: null, turnCount: 0, sessionStarted: true,
  createdAt: NOW, updatedAt: NOW, endedAt: null, ...over
})
const mistake = (over: Partial<Parameters<typeof insertMistake>[1]> = {}): Parameters<typeof insertMistake>[1] => ({
  conversationId: C1, messageId: null, original: 'I goed', improved: 'I went', explanationZh: 'go 的过去式是 went', category: 'grammar', ...over
})
let n = 0
const uid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  n = 0
  insertConversation(db, conv(C1, { turnCount: 4 }))
  insertConversation(db, conv(C2, { turnCount: 1 }))
})

describe('mistakes', () => {
  it('inserts with first review in one day and skips same-conversation duplicates', () => {
    expect(insertMistake(db, mistake(), NOW, uid())).toBe(true)
    expect(insertMistake(db, mistake(), NOW, uid())).toBe(false)
    expect(insertMistake(db, mistake({ conversationId: C2 }), NOW, uid())).toBe(true)
    const all = listMistakes(db, 'all', NOW)
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ reviewCount: 0, status: 'pending', nextReviewAt: addDays(NOW, 1) })
  })
  it('filters: due / category / mastered, due ordered by next_review_at', () => {
    const a = uid(); const b = uid(); const c = uid()
    insertMistake(db, mistake({ original: 'a' }), NOW, a)
    insertMistake(db, mistake({ original: 'b', category: 'word_choice' }), addDays(NOW, -5), b)
    insertMistake(db, mistake({ original: 'c' }), addDays(NOW, -3), c)
    expect(listMistakes(db, 'due', NOW).map((m) => m.original)).toEqual(['b', 'c'])
    expect(listMistakes(db, 'word_choice', NOW).map((m) => m.original)).toEqual(['b'])
    setMistakeMastered(db, c)
    expect(listMistakes(db, 'mastered', NOW).map((m) => m.original)).toEqual(['c'])
    expect(listMistakes(db, 'all', NOW).map((m) => m.original)).toEqual(['b', 'a'])
    expect(dueMistakes(db, NOW, 5).map((m) => m.id)).toEqual([b])
  })
  it('review advances the schedule; mastered ones are not reviewed', () => {
    const a = uid()
    insertMistake(db, mistake(), NOW, a)
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0]).toMatchObject({ reviewCount: 1, nextReviewAt: addDays(NOW, 3) })
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0]).toMatchObject({ reviewCount: 2, nextReviewAt: addDays(NOW, 7) })
    setMistakeMastered(db, a)
    markMistakeReviewed(db, a, NOW)
    expect(getMistakesByIds(db, [a])[0].reviewCount).toBe(2)
  })
  it('getMistakesByIds keeps order and skips missing; delete works', () => {
    const a = uid(); const b = uid()
    insertMistake(db, mistake({ original: 'a' }), NOW, a)
    insertMistake(db, mistake({ original: 'b' }), NOW, b)
    expect(getMistakesByIds(db, [b, 'missing', a]).map((m) => m.id)).toEqual([b, a])
    deleteMistake(db, a)
    expect(getMistakesByIds(db, [a])).toEqual([])
  })
  it('deleting a conversation keeps its mistakes with null sources', () => {
    insertMessage(db, { id: 'm1', conversationId: C1, role: 'assistant', content: 'x', structured: null, status: 'done', fromAsr: false, createdAt: NOW })
    insertMistake(db, mistake({ messageId: 'm1' }), NOW, uid())
    deleteConversation(db, C1)
    expect(listMistakes(db, 'all', NOW)[0]).toMatchObject({ conversationId: null, messageId: null })
  })
  it('per-conversation and recent queries', () => {
    insertMistake(db, mistake(), addDays(NOW, -40), uid())
    insertMistake(db, mistake({ original: 'new' }), NOW, uid())
    expect(mistakesForConversation(db, C1)).toHaveLength(2)
    expect(recentMistakes(db, addDays(NOW, -30)).map((m) => m.original)).toEqual(['new'])
  })
})

describe('vocabulary', () => {
  it('upserts case-insensitively, counting sightings without overwriting meaning', () => {
    upsertVocab(db, { word: 'Commute', meaningZh: '通勤', example: 'e1', source: 'conversation', sourceId: C1 }, NOW, uid())
    upsertVocab(db, { word: 'commute', meaningZh: '别的', example: 'e2', source: 'lesson', sourceId: null }, NOW, uid())
    const [v] = listVocab(db, '')
    expect(v).toMatchObject({ word: 'Commute', meaningZh: '通勤', seenCount: 2, familiarity: 0, source: 'conversation', sourceId: C1 })
  })
  it('search matches word or meaning; ordering by familiarity then newest', () => {
    const a = uid()
    upsertVocab(db, { word: 'apple', meaningZh: '苹果', example: '', source: 'lesson', sourceId: null }, NOW, a)
    upsertVocab(db, { word: 'banana', meaningZh: '香蕉', example: '', source: 'lesson', sourceId: null }, addDays(NOW, 1), uid())
    expect(listVocab(db, '').map((v) => v.word)).toEqual(['banana', 'apple'])
    setVocabFamiliarity(db, a, 3)
    expect(listVocab(db, '').map((v) => v.word)).toEqual(['banana', 'apple'])
    expect(listVocab(db, '苹').map((v) => v.word)).toEqual(['apple'])
    expect(listVocab(db, 'BAN').map((v) => v.word)).toEqual(['banana'])
    deleteVocab(db, a)
    expect(listVocab(db, 'apple')).toEqual([])
  })
  it('clears sources when a conversation or lesson is deleted', () => {
    const L = '33333333-3333-4333-8333-333333333333'
    insertLesson(db, { id: L, title: 'L', body: 'b', source: 'text', notesZh: '', vocabulary: [], createdAt: NOW, assets: [] })
    upsertVocab(db, { word: 'a', meaningZh: '', example: '', source: 'conversation', sourceId: C1 }, NOW, uid())
    upsertVocab(db, { word: 'b', meaningZh: '', example: '', source: 'lesson', sourceId: L }, NOW, uid())
    deleteConversation(db, C1)
    deleteLesson(db, L)
    expect(listVocab(db, '').every((v) => v.sourceId === null)).toBe(true)
    clearVocabSource(db, 'lesson', 'nothing')
  })
})

describe('practice sessions, profile, stats', () => {
  it('practice session lifecycle', () => {
    insertPracticeSession(db, C1, 'targeted', NOW, ['x', 'y'])
    markSessionEnded(db, C1, NOW)
    markSessionEnded(db, C1, addDays(NOW, 1))
    expect(getPracticeSession(db, C1)).toMatchObject({ mode: 'targeted', endedAt: NOW, reviewedMistakeIds: ['x', 'y'], reviewsApplied: false, summary: null })
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([C1])
    markReviewsApplied(db, C1)
    saveSessionSummary(db, C1, { practiced: '点餐', performanceZh: '好', issues: ['冠词'] })
    expect(getPracticeSession(db, C1)).toMatchObject({ reviewsApplied: true, summary: { practiced: '点餐' } })
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([])
    expect(recentSummaries(db, 10)).toEqual([{ conversationId: C1, endedAt: NOW, summary: { practiced: '点餐', performanceZh: '好', issues: ['冠词'] } }])
    expect(summariesSince(db, addDays(NOW, -1))).toBe(1)
  })
  it('sessions below the turn threshold or not ended are not summarized', () => {
    insertPracticeSession(db, C2, 'free', NOW, [])
    markSessionEnded(db, C2, NOW)
    insertPracticeSession(db, C1, 'free', NOW, [])
    expect(sessionsNeedingSummary(db, 3, 10)).toEqual([])
  })
  it('profile round-trips and overwrites the single row', () => {
    expect(getProfile(db)).toBeNull()
    const p = { level: 'B1' as const, weaknesses: ['冠词'], progress: [], suggestions: ['多练'], summaryZh: '中级', updatedAt: NOW }
    saveProfile(db, p)
    saveProfile(db, { ...p, level: 'B2' })
    expect(getProfile(db)).toEqual({ ...p, level: 'B2' })
  })
  it('stats', () => {
    insertMistake(db, mistake(), addDays(NOW, -2), uid())
    insertMistake(db, mistake({ original: 'x', category: 'naturalness' }), NOW, uid())
    const m = uid()
    insertMistake(db, mistake({ original: 'y' }), NOW, m)
    setMistakeMastered(db, m)
    const a = uid()
    upsertVocab(db, { word: 'a', meaningZh: '', example: '', source: 'lesson', sourceId: null }, NOW, a)
    upsertVocab(db, { word: 'b', meaningZh: '', example: '', source: 'lesson', sourceId: null }, NOW, uid())
    setVocabFamiliarity(db, a, 5)
    insertPracticeSession(db, C1, 'free', NOW, [])
    insertPracticeSession(db, C2, 'free', NOW, [])
    expect(learningStats(db, NOW)).toEqual({
      mistakesByCategory: { grammar: 1, word_choice: 0, naturalness: 1, other: 0 },
      mistakesPending: 2,
      mistakesDue: 1,
      mistakesMastered: 1,
      vocabTotal: 2,
      vocabByFamiliarity: [1, 0, 0, 0, 0, 1],
      sessions: 2,
      totalTurns: 5
    })
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/learning/review.test.ts src/main/db/learning-db.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 写 `src/main/learning/review.ts`**

```ts
import { REVIEW_INTERVALS_DAYS } from '@shared/types'

const DAY_MS = 24 * 60 * 60 * 1000

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

export function firstReviewAt(now: string): string {
  return addDays(now, REVIEW_INTERVALS_DAYS[0])
}

export function nextReviewAfter(reviewCount: number, now: string): string {
  const idx = Math.min(Math.max(reviewCount, 0), REVIEW_INTERVALS_DAYS.length - 1)
  return addDays(now, REVIEW_INTERVALS_DAYS[idx])
}
```

- [ ] **Step 5: 迁移 2（`src/main/db/migrations.ts` 的 `MIGRATIONS` 追加第二项）**

```ts
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
```

（已有会话补登记练习记录，这样它们也能被统计和补跑小结。）`db.test.ts` 里 `migrate` 返回值 1 → 2，表清单按字母序加 `learner_profile`、`mistakes`、`practice_sessions`、`vocabulary`。

- [ ] **Step 6: 写 `src/main/db/mistakes.ts`**

```ts
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
  ).run(id, m.conversationId, m.messageId, m.original, m.improved, m.explanationZh, m.category, firstReviewAt(now), now)
  return true
}

export function listMistakes(db: Db, filter: MistakeFilter, now: string): Mistake[] {
  if (filter === 'mastered') {
    return rows(db, `SELECT * FROM mistakes WHERE status = 'mastered' ORDER BY created_at DESC`)
  }
  if (filter === 'due') {
    return rows(db, `SELECT * FROM mistakes WHERE status = 'pending' AND next_review_at <= ? ORDER BY next_review_at ASC`, now)
  }
  if (filter === 'all') {
    return rows(db, `SELECT * FROM mistakes WHERE status = 'pending' ORDER BY next_review_at ASC, created_at DESC`)
  }
  return rows(db, `SELECT * FROM mistakes WHERE status = 'pending' AND category = ? ORDER BY next_review_at ASC, created_at DESC`, filter)
}

export function dueMistakes(db: Db, now: string, limit: number): Mistake[] {
  return rows(db, `SELECT * FROM mistakes WHERE status = 'pending' AND next_review_at <= ? ORDER BY next_review_at ASC LIMIT ?`, now, limit)
}

export function getMistakesByIds(db: Db, ids: string[]): Mistake[] {
  if (ids.length === 0) return []
  const found = rows(db, `SELECT * FROM mistakes WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const byId = new Map(found.map((m) => [m.id, m]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export function markMistakeReviewed(db: Db, id: string, now: string): void {
  const row = db.prepare(`SELECT review_count FROM mistakes WHERE id = ? AND status = 'pending'`).get(id) as
    | { review_count: number }
    | undefined
  if (!row) return
  const count = row.review_count + 1
  db.prepare('UPDATE mistakes SET review_count = ?, next_review_at = ? WHERE id = ?').run(count, nextReviewAfter(count, now), id)
}

export function setMistakeMastered(db: Db, id: string): void {
  db.prepare(`UPDATE mistakes SET status = 'mastered' WHERE id = ?`).run(id)
}

export function deleteMistake(db: Db, id: string): void {
  db.prepare('DELETE FROM mistakes WHERE id = ?').run(id)
}

export function mistakesForConversation(db: Db, conversationId: string): Mistake[] {
  return rows(db, 'SELECT * FROM mistakes WHERE conversation_id = ? ORDER BY created_at ASC', conversationId)
}

export function recentMistakes(db: Db, sinceIso: string): Mistake[] {
  return rows(db, 'SELECT * FROM mistakes WHERE created_at >= ? ORDER BY created_at DESC', sinceIso)
}
```

- [ ] **Step 7: 写 `src/main/db/vocabulary.ts`**

```ts
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

export function clearVocabSource(db: Db, source: 'conversation' | 'lesson', sourceId: string): void {
  db.prepare('UPDATE vocabulary SET source_id = NULL WHERE source = ? AND source_id = ?').run(source, sourceId)
}
```

注意：SQLite 的 `LIKE` 对 ASCII 默认不区分大小写，满足 `'BAN'` 能搜到 `banana`。

- [ ] **Step 8: 写 `src/main/db/practice.ts`、`profile.ts`、`stats.ts`**

`practice.ts`：

```ts
import type { Mode, SessionSummary } from '@shared/types'
import type { Db } from './index'

export interface PracticeSession {
  conversationId: string
  mode: Mode
  startedAt: string
  endedAt: string | null
  summary: SessionSummary | null
  reviewedMistakeIds: string[]
  reviewsApplied: boolean
}

interface Row {
  conversation_id: string
  mode: string
  started_at: string
  ended_at: string | null
  summary_json: string | null
  reviewed_mistake_ids: string
  reviews_applied: number
}

const toSession = (r: Row): PracticeSession => ({
  conversationId: r.conversation_id,
  mode: r.mode as Mode,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  summary: r.summary_json ? (JSON.parse(r.summary_json) as SessionSummary) : null,
  reviewedMistakeIds: JSON.parse(r.reviewed_mistake_ids) as string[],
  reviewsApplied: r.reviews_applied === 1
})

export function insertPracticeSession(db: Db, conversationId: string, mode: Mode, startedAt: string, reviewedMistakeIds: string[]): void {
  db.prepare(
    `INSERT OR IGNORE INTO practice_sessions (conversation_id, mode, started_at, reviewed_mistake_ids) VALUES (?, ?, ?, ?)`
  ).run(conversationId, mode, startedAt, JSON.stringify(reviewedMistakeIds))
}

export function getPracticeSession(db: Db, conversationId: string): PracticeSession | undefined {
  const row = db.prepare('SELECT * FROM practice_sessions WHERE conversation_id = ?').get(conversationId) as unknown as Row | undefined
  return row ? toSession(row) : undefined
}

export function markSessionEnded(db: Db, conversationId: string, endedAt: string): void {
  db.prepare('UPDATE practice_sessions SET ended_at = ? WHERE conversation_id = ? AND ended_at IS NULL').run(endedAt, conversationId)
}

export function markReviewsApplied(db: Db, conversationId: string): void {
  db.prepare('UPDATE practice_sessions SET reviews_applied = 1 WHERE conversation_id = ?').run(conversationId)
}

export function saveSessionSummary(db: Db, conversationId: string, summary: SessionSummary): void {
  db.prepare('UPDATE practice_sessions SET summary_json = ? WHERE conversation_id = ?').run(JSON.stringify(summary), conversationId)
}

export function sessionsNeedingSummary(db: Db, minTurns: number, limit: number): string[] {
  return (
    db.prepare(
      `SELECT p.conversation_id AS id FROM practice_sessions p JOIN conversations c ON c.id = p.conversation_id
       WHERE p.ended_at IS NOT NULL AND p.summary_json IS NULL AND c.turn_count >= ?
       ORDER BY p.ended_at DESC LIMIT ?`
    ).all(minTurns, limit) as unknown as { id: string }[]
  ).map((r) => r.id)
}

export function recentSummaries(db: Db, limit: number): Array<{ conversationId: string; endedAt: string | null; summary: SessionSummary }> {
  return (
    db.prepare(
      `SELECT conversation_id, ended_at, summary_json FROM practice_sessions WHERE summary_json IS NOT NULL ORDER BY ended_at DESC LIMIT ?`
    ).all(limit) as unknown as { conversation_id: string; ended_at: string | null; summary_json: string }[]
  ).map((r) => ({ conversationId: r.conversation_id, endedAt: r.ended_at, summary: JSON.parse(r.summary_json) as SessionSummary }))
}

export function summariesSince(db: Db, sinceIso: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM practice_sessions WHERE summary_json IS NOT NULL AND ended_at >= ?'
  ).get(sinceIso) as { n: number }
  return row.n
}
```

`profile.ts`：

```ts
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
  const r = db.prepare('SELECT * FROM learner_profile WHERE id = 1').get() as unknown as Row | undefined
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
  ).run(p.level, JSON.stringify(p.weaknesses), JSON.stringify(p.progress), JSON.stringify(p.suggestions), p.summaryZh, p.updatedAt)
}
```

`stats.ts`：

```ts
import type { CorrectionCategory, LearningStats } from '@shared/types'
import type { Db } from './index'

const count = (db: Db, sql: string, ...params: string[]): number =>
  (db.prepare(sql).get(...params) as { n: number }).n

export function learningStats(db: Db, now: string): LearningStats {
  const byCategory: Record<CorrectionCategory, number> = { grammar: 0, word_choice: 0, naturalness: 0, other: 0 }
  for (const r of db
    .prepare(`SELECT category, COUNT(*) AS n FROM mistakes WHERE status = 'pending' GROUP BY category`)
    .all() as unknown as { category: CorrectionCategory; n: number }[]) {
    if (r.category in byCategory) byCategory[r.category] = r.n
  }
  const fam = [0, 0, 0, 0, 0, 0]
  for (const r of db
    .prepare('SELECT familiarity AS f, COUNT(*) AS n FROM vocabulary GROUP BY familiarity')
    .all() as unknown as { f: number; n: number }[]) {
    if (r.f >= 0 && r.f <= 5) fam[r.f] = r.n
  }
  return {
    mistakesByCategory: byCategory,
    mistakesPending: count(db, `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'pending'`),
    mistakesDue: count(db, `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'pending' AND next_review_at <= ?`, now),
    mistakesMastered: count(db, `SELECT COUNT(*) AS n FROM mistakes WHERE status = 'mastered'`),
    vocabTotal: count(db, 'SELECT COUNT(*) AS n FROM vocabulary'),
    vocabByFamiliarity: fam,
    sessions: count(db, 'SELECT COUNT(*) AS n FROM practice_sessions'),
    totalTurns: count(db, 'SELECT COALESCE(SUM(turn_count), 0) AS n FROM conversations')
  }
}
```

- [ ] **Step 9: 删除时置空生词来源**

`src/main/db/conversations.ts` 的 `deleteConversation` 里在删除前调用 `clearVocabSource(db, 'conversation', id)`；`src/main/db/lessons.ts` 的 `deleteLesson` 里同样调用 `clearVocabSource(db, 'lesson', id)`（`import { clearVocabSource } from './vocabulary'`）。

- [ ] **Step 10: 跑测试、typecheck、提交**

Run: `npx vitest run src/main/db src/main/learning && npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/main/db src/main/learning/review.ts src/main/learning/review.test.ts
git commit -m "feat: 错句、生词、练习记录、学习画像的数据层与复习间隔

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 提示词：针对性练习、会话小结、画像分析，画像摘要注入

**Files:**
- Create: `src/main/prompts/targeted-practice.md`、`src/main/prompts/summarize-session.md`、`src/main/prompts/analyze-learner.md`
- Modify: `src/main/learning/prompts.ts`
- Test: `src/main/learning/prompts.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 1 `LearnerProfile`、`Mistake`。
- Produces：

```ts
export interface TargetedMaterial { weaknesses: string[]; mistakes: Array<{ original: string; improved: string }> }
export interface PromptContext { ...现有字段; targeted?: TargetedMaterial }   // mode 'targeted' 时必须提供（可为空数组）
export function formatProfileSummary(p: Pick<LearnerProfile, 'level' | 'weaknesses'>): string
export const SUMMARIZE_SESSION_PROMPT: string
export const ANALYZE_LEARNER_PROMPT: string
```

- [ ] **Step 1: 给 `src/main/learning/prompts.test.ts` 加失败的测试**

把现有 `rejects targeted mode for now` 用例删掉，加：

```ts
describe('targeted mode and profile summary', () => {
  const base = { difficulty: 'intermediate' as const, chineseExplanations: true }
  it('requires targeted material and lists weaknesses and mistakes', () => {
    expect(() => buildSystemPrompt({ ...base, mode: 'targeted' })).toThrow(/targeted/)
    const p = buildSystemPrompt({
      ...base,
      mode: 'targeted',
      targeted: {
        weaknesses: ['irregular past tense', 'articles'],
        mistakes: [{ original: 'I goed home', improved: 'I went home' }]
      }
    })
    expect(p).toContain('Mode: targeted practice')
    expect(p).toContain('- irregular past tense')
    expect(p).toContain('"I goed home" → "I went home"')
  })
  it('works with empty material (general review)', () => {
    const p = buildSystemPrompt({ ...base, mode: 'targeted', targeted: { weaknesses: [], mistakes: [] } })
    expect(p).toContain('No recorded weak points yet')
  })
  it('formats the profile summary with at most three weaknesses', () => {
    expect(formatProfileSummary({ level: 'B1', weaknesses: ['a', 'b', 'c', 'd'] })).toBe(
      'Estimated level: B1. Focus areas: a; b; c.'
    )
    expect(formatProfileSummary({ level: 'A2', weaknesses: [] })).toBe('Estimated level: A2.')
  })
  it('exports the analysis prompts', () => {
    expect(SUMMARIZE_SESSION_PROMPT).toContain('performanceZh')
    expect(ANALYZE_LEARNER_PROMPT).toContain('weaknesses')
  })
})
```

（import 增加 `formatProfileSummary, SUMMARIZE_SESSION_PROMPT, ANALYZE_LEARNER_PROMPT`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/learning/prompts.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写三个提示词文件**

`src/main/prompts/targeted-practice.md`：

```md
Mode: targeted practice.
This session trains the learner's weak points listed below. Design a short, natural conversation (one realistic everyday or work situation) in which the learner has to use exactly those structures. Ask questions that make the learner produce them; do not quiz grammar directly and do not reveal the list. When the learner gets one right, acknowledge it briefly and move on to the next weak point. For the past mistakes listed below, create a moment where the learner can say the corrected form naturally. Keep corrections focused on these targets first.
```

`src/main/prompts/summarize-session.md`：

```md
You summarize one English practice session for a Chinese learner.

You receive the conversation transcript (Tutor / Learner lines) and the corrections recorded during the session.

Return:
- `practiced`: a short Chinese phrase naming what was practiced (topic or situation), e.g. "餐厅点餐角色扮演".
- `performanceZh`: two to four sentences in Chinese on how the learner did: fluency, accuracy, what went well.
- `issues`: up to five short Chinese phrases naming recurring language problems seen in this session (e.g. "不规则动词过去式", "冠词 a/the"). Empty if none.

Be specific and honest; base everything on the transcript only.
```

`src/main/prompts/analyze-learner.md`：

```md
You assess an adult Chinese learner of English from their recent practice data.

You receive: recent corrections grouped by category with examples, vocabulary counts by familiarity (0 = new, 5 = mastered), recent session summaries, and the previous assessment if any.

Return:
- `level`: the learner's estimated CEFR level, one of A1, A2, B1, B2, C1. Change it only when the evidence clearly supports it.
- `weaknesses`: up to five concrete language points to work on, most important first, as short Chinese phrases (e.g. "不规则动词过去式", "工作会议常用表达").
- `progress`: up to five short Chinese phrases on improvements compared with the previous assessment or earlier data. Empty if there is no basis.
- `suggestions`: up to five concrete next steps in Chinese (what to practice, which mode to use).
- `summaryZh`: three to five sentences in Chinese giving an overall picture, warm and honest.

Base everything on the data provided; do not invent results.
```

- [ ] **Step 4: 修改 `src/main/learning/prompts.ts`**

导入三个新文件（`?raw`），导出常量，`MODE_PROMPT` 改为覆盖全部 5 种模式，并加 targeted 与画像摘要：

```ts
import targetedPractice from '../prompts/targeted-practice.md?raw'
import summarizeSession from '../prompts/summarize-session.md?raw'
import analyzeLearner from '../prompts/analyze-learner.md?raw'
import type { Difficulty, LearnerProfile, Mode } from '@shared/types'

export const SUMMARIZE_SESSION_PROMPT: string = summarizeSession
export const ANALYZE_LEARNER_PROMPT: string = analyzeLearner

export interface TargetedMaterial {
  weaknesses: string[]
  mistakes: Array<{ original: string; improved: string }>
}

export interface PromptContext {
  mode: Mode
  difficulty: Difficulty
  chineseExplanations: boolean
  lesson?: { title: string; body: string; notesZh: string }
  scenario?: string
  profileSummary?: string
  targeted?: TargetedMaterial
}

const MODE_PROMPT: Record<Mode, string> = {
  free: freeChat,
  lesson: lessonQa,
  roleplay: rolePlay,
  scenario: scenarioTask,
  targeted: targetedPractice
}

export function formatProfileSummary(p: Pick<LearnerProfile, 'level' | 'weaknesses'>): string {
  const focus = p.weaknesses.slice(0, 3)
  return focus.length
    ? `Estimated level: ${p.level}. Focus areas: ${focus.join('; ')}.`
    : `Estimated level: ${p.level}.`
}

function formatTargeted(t: TargetedMaterial): string {
  if (t.weaknesses.length === 0 && t.mistakes.length === 0) {
    return 'No recorded weak points yet: run a general review of common everyday structures at the learner level.'
  }
  const parts: string[] = []
  if (t.weaknesses.length) parts.push(`Weak points:\n${t.weaknesses.map((w) => `- ${w}`).join('\n')}`)
  if (t.mistakes.length) {
    parts.push(`Past mistakes to revisit:\n${t.mistakes.map((m) => `- "${m.original}" → "${m.improved}"`).join('\n')}`)
  }
  return parts.join('\n\n')
}
```

`buildSystemPrompt` 里：删掉 `if (ctx.mode === 'targeted') throw ...`，改为 `if (ctx.mode === 'targeted' && !ctx.targeted) throw new Error('targeted mode requires targeted material')`；在模式提示词之后（课文 / 场景之前）加 `if (ctx.mode === 'targeted' && ctx.targeted) parts.push(formatTargeted(ctx.targeted))`。

- [ ] **Step 5: 跑测试、typecheck、提交**

Run: `npx vitest run src/main/learning && npm run typecheck`
Expected: 全绿。

```bash
git add src/main/prompts src/main/learning/prompts.ts src/main/learning/prompts.test.ts
git commit -m "feat: 针对性练习、会话小结、学习画像的提示词与画像摘要

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ChatService / LessonService 写入学习记录

**Files:**
- Modify: `src/main/chat/service.ts`、`src/main/lessons/service.ts`
- Test: `src/main/chat/service.test.ts`、`src/main/lessons/service.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 2 `insertMistake`、`upsertVocab`、`insertPracticeSession`、`getPracticeSession`、`dueMistakes`、`getMistakesByIds`、`getProfile`；Task 3 `buildSystemPrompt`（`targeted`、`profileSummary`）、`formatProfileSummary`。
- Produces：行为变化，无新导出。

规则（实现与测试都按这个）：
- `createConversation`：插入会话后 `insertPracticeSession(db, id, mode, now, ids)`，其中 `targeted` 模式的 `ids = dueMistakes(db, now, 5).map(m => m.id)`，其他模式 `[]`。
- `runTurn` 首轮拼系统提示时：`profile = getProfile(db)`，有则 `profileSummary = formatProfileSummary(profile)`；`targeted` 模式下 `targeted = { weaknesses: profile?.weaknesses.slice(0, 3) ?? [], mistakes: getMistakesByIds(db, session.reviewedMistakeIds).map(({ original, improved }) => ({ original, improved })) }`（session 不存在时视为空数组）。
- `done` 且 `ev.structured` 有效、且本轮不是开场轮（开场轮的 `text === OPENING_INSTRUCTION`，在 `startTurn` 里传一个 `isOpening` 标志给 `runTurn`）：
  - `structured.correction` 存在且 `uncertain !== true` → `insertMistake(db, { conversationId, messageId: assistantMessageId, original, improved, explanationZh, category }, now, uuid())`。
  - `structured.vocabulary` 每项 → `upsertVocab(db, { word, meaningZh, example, source: 'conversation', sourceId: conversationId }, now, uuid())`。
  - 写入失败（异常）只 `console.warn`，不影响本轮 `done`。
- `LessonService.save`：课程插入后，`input.vocabulary` 每项 `upsertVocab(..., source: 'lesson', sourceId: lesson.id)`。

- [ ] **Step 1: 给 `src/main/chat/service.test.ts` 加失败的测试**

```ts
import { listMistakes, insertMistake } from '../db/mistakes'
import { listVocab } from '../db/vocabulary'
import { getPracticeSession } from '../db/practice'
import { saveProfile } from '../db/profile'

describe('learning records', () => {
  const NOW_ANY = '2026-10-13T08:00:00.000Z'
  it('records a non-uncertain correction and vocabulary after a user turn, not on the opening turn', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')).toHaveLength(0)
    expect(listVocab(db, '')).toHaveLength(0)
    await svc.send({ conversationId: conversation.id, text: 'I goed to work' })
    await svc.whenIdle(conversation.id)
    const mistakes = listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]).toMatchObject({ conversationId: conversation.id, original: 'I goed to work', improved: 'I went to work', category: 'grammar' })
    expect(listVocab(db, '')).toMatchObject([{ word: 'commute', source: 'conversation', sourceId: conversation.id }])
    expect(getPracticeSession(db, conversation.id)).toMatchObject({ mode: 'free', reviewedMistakeIds: [] })
  })
  it('skips uncertain corrections and same-conversation duplicates', async () => {
    const ai = new FakeAIProvider({
      reply: { reply: 'ok', correction: { original: 'x', improved: 'y', explanationZh: 'z', category: 'other', uncertain: true } }
    })
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    await svc.send({ conversationId: conversation.id, text: 'x' })
    await svc.whenIdle(conversation.id)
    expect(listMistakes(db, 'all', '2100-01-01T00:00:00.000Z')).toHaveLength(0)
  })
  it('targeted mode selects due mistakes once at creation and puts them and the profile in the first-turn prompt', async () => {
    insertMistake(db, { conversationId: null, messageId: null, original: 'He go', improved: 'He goes', explanationZh: '三单', category: 'grammar' }, '2020-01-01T00:00:00.000Z', '99999999-9999-4999-8999-999999999999')
    saveProfile(db, { level: 'B1', weaknesses: ['third person -s', 'articles', 'past tense', 'extra'], progress: [], suggestions: [], summaryZh: 's', updatedAt: NOW_ANY })
    const ai = new FakeAIProvider({ failWith: 'network' })
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'targeted' })
    await svc.whenIdle(conversation.id)
    expect(getPracticeSession(db, conversation.id)?.reviewedMistakeIds).toEqual(['99999999-9999-4999-8999-999999999999'])
    const prompt1 = ai.calls[0].systemPrompt!
    expect(prompt1).toContain('Estimated level: B1. Focus areas: third person -s; articles; past tense.')
    expect(prompt1).toContain('"He go" → "He goes"')
    expect(prompt1).not.toContain('extra')
    // 首轮失败后重试：仍是同一批材料
    await svc.send({ conversationId: conversation.id, text: 'hi' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1].firstTurn).toBe(true)
    expect(ai.calls[1].systemPrompt).toContain('"He go" → "He goes"')
  })
  it('injects the profile summary into other modes too', async () => {
    saveProfile(db, { level: 'A2', weaknesses: [], progress: [], suggestions: [], summaryZh: 's', updatedAt: NOW_ANY })
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[0].systemPrompt).toContain('Estimated level: A2.')
  })
})
```

（`mk`、`db`、`FakeAIProvider` 沿用该文件已有的辅助。若该文件的 `uuid` 注入只准备了固定数量的 id，扩充或改为递增生成，保证新插入的错句 / 生词 / 练习记录 id 唯一。）

- [ ] **Step 2: 给 `src/main/lessons/service.test.ts` 加失败的测试**

```ts
  it('saving a lesson adds its vocabulary to the vocabulary book', () => {
    const svc = new LessonService({ db, ai: new FakeAIProvider(), lessonsDir: dir })
    const lesson = svc.save({ ...extraction, source: 'text' })
    expect(listVocab(db, '')).toMatchObject([{ word: 'morning', source: 'lesson', sourceId: lesson.id }])
  })
```

（`import { listVocab } from '../db/vocabulary'`；若现有 `uuid` 注入返回固定值，改为队列或递增，避免生词 id 与课程 id 冲突。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/chat src/main/lessons`
Expected: 新用例 FAIL。

- [ ] **Step 4: 实现**

按上方"规则"修改 `src/main/chat/service.ts` 与 `src/main/lessons/service.ts`。`ChatService` 的写入放在 `done` 分支 `updateMessage` 之后，包在 `try { ... } catch (e) { console.warn('[my-tutor] 学习记录写入失败', e) }` 里。`createConversation` 中 `targeted` 选材使用 `this.now()`。

- [ ] **Step 5: 跑测试、typecheck、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/main/chat src/main/lessons
git commit -m "feat: 对话与课程自动写入错句本、生词本，针对性练习选材与画像注入

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: LearningService（会话结束、小结、画像、统计）

**Files:**
- Create: `src/main/learning/service.ts`
- Test: `src/main/learning/service.test.ts`

**Interfaces:**
- Consumes：Task 2 全部 db 函数；Task 3 `SUMMARIZE_SESSION_PROMPT`、`ANALYZE_LEARNER_PROMPT`；Task 1 `SessionSummarySchema`、`LearnerProfileOutputSchema`、`AnalyzeOutcome`；M1 `AIProvider.analyze`、`getConversation`、`listMessages`、`getSettings`、`patchSettings`。
- Produces：

```ts
export const SUMMARY_MIN_TURNS = 3
export interface LearningServiceDeps { db: Db; ai: AIProvider; now?: () => string }
export class LearningService {
  constructor(deps: LearningServiceDeps)
  endConversation(conversationId: string): Promise<void>   // 幂等；永不 reject
  summarize(conversationId: string): Promise<void>          // 同一会话并发调用只跑一次；失败静默
  sweepPendingSummaries(limit?: number): Promise<void>      // 启动时补跑，默认 3 个，串行
  analyzeProfile(): Promise<AnalyzeOutcome>                 // 永不 reject
  maybeAutoAnalyze(): Promise<void>                         // 24 h + 有新数据时才跑；永不 reject
  stats(): LearningStats
  profile(): LearnerProfile | null
}
export function buildSummaryInput(messages: Message[], mistakes: Mistake[]): string
export function buildProfileInput(args: { mistakes: Mistake[]; stats: LearningStats; summaries: SessionSummary[]; previous: LearnerProfile | null }): string
```

规则：
- `endConversation(id)`：会话不存在则返回；`markSessionEnded(db, id, now)`；若练习记录 `reviewsApplied` 为假且 `reviewedMistakeIds` 非空 → 对每个 id `markMistakeReviewed(db, id, now)`，然后 `markReviewsApplied`（只推进一次）；然后若 `turnCount >= SUMMARY_MIN_TURNS` 且无小结 → `await this.summarize(id)`。整个函数 try/catch，异常只 `console.warn`。
- `summarize(id)`：用 `Map<string, Promise<void>>` 去重并发；取 `listMessages` 中 `status === 'done'` 的最近 20 条，转成 `Tutor: ...` / `Learner: ...` 行（`fromAsr` 的学习者行加 `(spoken)` 前缀）；加上 `mistakesForConversation` 的 `original → improved (category)` 行；调 `ai.analyze({ systemPrompt: SUMMARIZE_SESSION_PROMPT, text, schema: SessionSummarySchema, model })`；成功 `saveSessionSummary`；失败静默。
- `sweepPendingSummaries(limit = 3)`：先把所有 `ended_at` 为空、且不是"当前进行中"的会话视为未结束（不处理）；只对 `sessionsNeedingSummary(db, SUMMARY_MIN_TURNS, limit)` 串行 `summarize`。另外：启动时把上一次运行遗留的、`turn_count >= 3` 且 `ended_at` 为空的练习记录补记 `ended_at = conversations.updated_at`（新增 db 函数 `closeStaleSessions(db: Db): void`，写在 `src/main/db/practice.ts`，SQL：`UPDATE practice_sessions SET ended_at = (SELECT updated_at FROM conversations c WHERE c.id = conversation_id) WHERE ended_at IS NULL`），由 `sweepPendingSummaries` 在开始时调用。这样上次退出时没来得及结束的会话也能补到小结。
- `analyzeProfile()`：`since = now - 30 天`；`mistakes = recentMistakes(db, since)`，`summaries = recentSummaries(db, 10)`；若 `mistakes.length === 0 && summaries.length === 0` 返回 `{ ok: false, message: '还没有足够的练习数据：先在聊天里练几轮，再来更新分析。' }`（不调用 Claude）；否则调 `analyze`（schema `LearnerProfileOutputSchema`），成功后 `saveProfile({ ...result, updatedAt: now })`，`patchSettings(db, { lastProfileAnalysisAt: now })`，返回 `{ ok: true, profile }`；异常返回 `{ ok: false, message: '分析失败：' + 消息 }`。
- `buildProfileInput`：按类别分组，每类计数 + 最多 5 条样例（`original → improved`）；生词总数与 `vocabByFamiliarity`；最近小结（`practiced` / `performanceZh` / `issues`）；上一版画像（level、weaknesses、summaryZh）或 `None`。输出为纯文本，英文标题 + 原始内容。
- `maybeAutoAnalyze()`：`last = getSettings(db).lastProfileAnalysisAt`；若 `last` 存在且距今不足 24 h 返回；`since = last ?? '1970-01-01T00:00:00.000Z'`；若 `recentMistakes(db, since).length === 0 && summariesSince(db, since) === 0` 返回；否则 `await this.analyzeProfile()`（结果忽略）。

- [ ] **Step 1: 写失败的测试 `src/main/learning/service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/index'
import { insertConversation } from '../db/conversations'
import { insertMessage } from '../db/messages'
import { getMistakesByIds, insertMistake } from '../db/mistakes'
import { getPracticeSession, insertPracticeSession, markSessionEnded, saveSessionSummary } from '../db/practice'
import { getProfile, saveProfile } from '../db/profile'
import { getSettings, patchSettings } from '../db/settings'
import { FakeAIProvider } from '../ai/fake'
import { addDays } from './review'
import { buildSummaryInput, LearningService } from './service'
import type { AnalyzeRequest } from '../ai/types'
import type { Conversation } from '@shared/types'

const NOW = '2026-10-13T08:00:00.000Z'
const C = '11111111-1111-4111-8111-111111111111'
const M = '22222222-2222-4222-8222-222222222222'
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: C, title: 't', mode: 'free', lessonId: null, scenario: null, turnCount: 3, sessionStarted: true,
  createdAt: NOW, updatedAt: NOW, endedAt: null, ...over
})
const summary = { practiced: '点餐', performanceZh: '表达流畅', issues: ['冠词'] }
const profileOut = { level: 'B1', weaknesses: ['冠词'], progress: [], suggestions: ['多练'], summaryZh: '中级' }

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})

const seedTalk = (): void => {
  insertMessage(db, { id: 'u1', conversationId: C, role: 'user', content: 'I goed home', structured: null, status: 'done', fromAsr: true, createdAt: NOW })
  insertMessage(db, { id: 'a1', conversationId: C, role: 'assistant', content: 'You went home!', structured: null, status: 'done', fromAsr: false, createdAt: addDays(NOW, 0.0001) })
  insertMessage(db, { id: 'a2', conversationId: C, role: 'assistant', content: '', structured: null, status: 'error', fromAsr: false, createdAt: addDays(NOW, 0.0002) })
}

describe('LearningService.endConversation', () => {
  it('marks ended, applies targeted reviews once, summarizes when long enough', async () => {
    insertConversation(db, conv({ mode: 'targeted' }))
    insertMistake(db, { conversationId: null, messageId: null, original: 'x', improved: 'y', explanationZh: 'z', category: 'grammar' }, addDays(NOW, -3), M)
    insertPracticeSession(db, C, 'targeted', NOW, [M])
    seedTalk()
    const ai = new FakeAIProvider({ analyzeResult: summary })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await svc.endConversation(C)
    await svc.endConversation(C)
    expect(getMistakesByIds(db, [M])[0].reviewCount).toBe(1)
    expect(getPracticeSession(db, C)).toMatchObject({ endedAt: NOW, reviewsApplied: true, summary })
    expect(ai.analyzeCalls).toHaveLength(1)
    const text = (ai.analyzeCalls[0] as AnalyzeRequest<unknown>).text
    expect(text).toContain('Learner (spoken): I goed home')
    expect(text).toContain('Tutor: You went home!')
    expect(text).not.toContain('status')
  })
  it('does not summarize short sessions and stays silent on failure', async () => {
    insertConversation(db, conv({ turnCount: 2 }))
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    await new LearningService({ db, ai, now: () => NOW }).endConversation(C)
    expect(ai.analyzeCalls).toHaveLength(0)

    const db2 = openDatabase(':memory:')
    insertConversation(db2, conv())
    insertPracticeSession(db2, C, 'free', NOW, [])
    const failing = new FakeAIProvider({ failWith: 'network' })
    await expect(new LearningService({ db: db2, ai: failing, now: () => NOW }).endConversation(C)).resolves.toBeUndefined()
    expect(getPracticeSession(db2, C)?.summary).toBeNull()
  })
  it('concurrent summarize calls run once', async () => {
    insertConversation(db, conv())
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await Promise.all([svc.summarize(C), svc.summarize(C)])
    expect(ai.analyzeCalls).toHaveLength(1)
  })
})

describe('LearningService.sweepPendingSummaries', () => {
  it('closes stale sessions and summarizes them', async () => {
    insertConversation(db, conv({ updatedAt: addDays(NOW, -1) }))
    insertPracticeSession(db, C, 'free', NOW, [])
    const ai = new FakeAIProvider({ analyzeResult: summary })
    await new LearningService({ db, ai, now: () => NOW }).sweepPendingSummaries()
    expect(getPracticeSession(db, C)).toMatchObject({ endedAt: addDays(NOW, -1), summary })
  })
})

describe('LearningService.analyzeProfile / maybeAutoAnalyze', () => {
  it('refuses without data and does not call Claude', async () => {
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const r = await new LearningService({ db, ai, now: () => NOW }).analyzeProfile()
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('还没有足够的练习数据') })
    expect(ai.analyzeCalls).toHaveLength(0)
  })
  it('saves the profile and the timestamp', async () => {
    insertMistake(db, { conversationId: null, messageId: null, original: 'a', improved: 'b', explanationZh: 'c', category: 'grammar' }, NOW, M)
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const r = await new LearningService({ db, ai, now: () => NOW }).analyzeProfile()
    expect(r).toEqual({ ok: true, profile: { ...profileOut, updatedAt: NOW } })
    expect(getProfile(db)).toEqual({ ...profileOut, updatedAt: NOW })
    expect(getSettings(db).lastProfileAnalysisAt).toBe(NOW)
    expect((ai.analyzeCalls[0] as AnalyzeRequest<unknown>).text).toContain('a → b')
  })
  it('maps failures to ok:false', async () => {
    insertMistake(db, { conversationId: null, messageId: null, original: 'a', improved: 'b', explanationZh: 'c', category: 'grammar' }, NOW, M)
    const r = await new LearningService({ db, ai: new FakeAIProvider({ failWith: 'network' }), now: () => NOW }).analyzeProfile()
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('分析失败') })
  })
  it('auto-analyzes only after 24 h and only with new data', async () => {
    const ai = new FakeAIProvider({ analyzeResult: profileOut })
    const svc = new LearningService({ db, ai, now: () => NOW })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(0)
    insertMistake(db, { conversationId: null, messageId: null, original: 'a', improved: 'b', explanationZh: 'c', category: 'grammar' }, addDays(NOW, -0.1), M)
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -0.5) })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(0)
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -2) })
    await svc.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(1)
    // 只有新小结（没有新错句）也算新数据
    patchSettings(db, { lastProfileAnalysisAt: addDays(NOW, -1.5) })
    insertConversation(db, conv())
    insertPracticeSession(db, C, 'free', addDays(NOW, -1), [])
    markSessionEnded(db, C, NOW)
    saveSessionSummary(db, C, summary)
    const later = new LearningService({ db, ai, now: () => addDays(NOW, 0.6) })
    await later.maybeAutoAnalyze()
    expect(ai.analyzeCalls).toHaveLength(2)
  })
  it('stats and profile pass through', () => {
    saveProfile(db, { ...profileOut, level: 'B1', updatedAt: NOW })
    const svc = new LearningService({ db, ai: new FakeAIProvider(), now: () => NOW })
    expect(svc.profile()?.level).toBe('B1')
    expect(svc.stats().sessions).toBe(0)
  })
})

describe('buildSummaryInput', () => {
  it('formats transcript lines and corrections', () => {
    const text = buildSummaryInput(
      [{ id: 'u', conversationId: C, role: 'user', content: 'hi', structured: null, status: 'done', fromAsr: false, createdAt: NOW }],
      [{ id: M, conversationId: C, messageId: null, original: 'a', improved: 'b', explanationZh: 'c', category: 'grammar', reviewCount: 0, nextReviewAt: NOW, status: 'pending', createdAt: NOW }]
    )
    expect(text).toContain('Learner: hi')
    expect(text).toContain('a → b (grammar)')
  })
})
```

（用例里 `now` 是测试注入的；`addDays(NOW, 0.6)` 距 `lastProfileAnalysisAt = NOW - 1.5` 已超过 24 h。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/learning/service.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 在 `src/main/db/practice.ts` 加 `closeStaleSessions`**

```ts
export function closeStaleSessions(db: Db): void {
  db.prepare(
    `UPDATE practice_sessions SET ended_at = (SELECT updated_at FROM conversations c WHERE c.id = practice_sessions.conversation_id)
     WHERE ended_at IS NULL`
  ).run()
}
```

（只在启动时调用：此时没有任何会话处于进行中。）

- [ ] **Step 4: 写 `src/main/learning/service.ts`**

按上方规则实现，签名见 Interfaces。要点：
- `summarize` 的去重：`private readonly summarizing = new Map<string, Promise<void>>()`；已有则返回同一个 promise；`finally` 删除。
- 所有对外方法内部 try/catch，日志用 `console.warn('[my-tutor] ...', e)`。
- `analyze` 调用传 `model: getSettings(db).model || undefined`。
- `buildSummaryInput` 只取 `status === 'done'` 且 `content` 非空的消息，最后 20 条，`role === 'assistant'` 为 `Tutor:`，学习者为 `Learner:` 或 `Learner (spoken):`；错句段标题 `Corrections recorded:`，每行 `- original → improved (category)`；无错句时写 `Corrections recorded: none`。
- `buildProfileInput` 段落标题依次为 `Corrections (last 30 days):`、`Vocabulary:`、`Recent session summaries:`、`Previous assessment:`。

- [ ] **Step 5: 跑测试、typecheck、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/main/learning src/main/db/practice.ts
git commit -m "feat: LearningService：会话结束推进复习、生成小结、学习画像与统计

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: IPC 注册、主进程装配、渲染进程页面骨架与"离开会话"通知

**Files:**
- Modify: `src/main/ipc/register.ts`、`src/main/ipc/register.test.ts`、`src/main/index.ts`
- Modify: `src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/components/ChatPage.tsx`
- Create（骨架，Task 7–9 填充）：`src/renderer/src/components/MistakesPage.tsx`、`VocabPage.tsx`、`AnalysisPage.tsx`

**Interfaces:**
- Consumes：Task 1 schema 与通道；Task 2 db 函数；Task 5 `LearningService`。
- Produces：
  - `Services` 增加 `learning: LearningService`；10 个新通道全部注册。
  - `Page` 类型改为 `'chat' | 'lessons' | 'mistakes' | 'vocab' | 'analysis' | 'settings'`。
  - 三个页面组件的 props（Task 7–9 必须保持）：`MistakesPage(): JSX.Element`、`VocabPage(): JSX.Element`、`AnalysisPage({ onStartTargeted }: { onStartTargeted: () => void }): JSX.Element`。

- [ ] **Step 1: 先改测试**

`src/main/ipc/register.test.ts`：去掉 Task 1 加的"暂时排除阶段 3 通道"；构造 `LearningService` 传入 `registerIpc` 的 services；追加断言：

```ts
    expect(await handlers.get(IPC.mistakesList)!({}, 'all')).toEqual([])
    await expect(handlers.get(IPC.mistakesList)!({}, 'spelling')).rejects.toThrow(/参数无效/)
    expect(await handlers.get(IPC.vocabList)!({}, '')).toEqual([])
    await expect(handlers.get(IPC.vocabSetFamiliarity)!({}, { id: 'nope', familiarity: 1 })).rejects.toThrow(/参数无效/)
    expect(await handlers.get(IPC.learningStats)!({})).toMatchObject({ sessions: expect.any(Number) })
    expect(await handlers.get(IPC.learningProfile)!({})).toBeNull()
    expect(await handlers.get(IPC.learningAnalyze)!({})).toMatchObject({ ok: false })
    await expect(handlers.get(IPC.conversationsEnd)!({}, created.conversation.id)).resolves.toBeUndefined()
```

Run: `npx vitest run src/main/ipc` → FAIL（未注册）。

- [ ] **Step 2: `src/main/ipc/register.ts`**

导入 `IdSchema, MistakeFilterSchema, VocabFamiliaritySchema, VocabSearchSchema`、db 函数与 `LearningService` 类型，`Services` 加 `learning`，追加：

```ts
  registerHandler(ipc, IPC.conversationsEnd, ConversationIdSchema, (id) => learning.endConversation(id))
  registerHandler(ipc, IPC.mistakesList, MistakeFilterSchema, (f) => listMistakes(db, f, new Date().toISOString()))
  registerHandler(ipc, IPC.mistakesMaster, IdSchema, (id) => {
    setMistakeMastered(db, id)
  })
  registerHandler(ipc, IPC.mistakesDelete, IdSchema, (id) => {
    deleteMistake(db, id)
  })
  registerHandler(ipc, IPC.vocabList, VocabSearchSchema, (q) => listVocab(db, q))
  registerHandler(ipc, IPC.vocabSetFamiliarity, VocabFamiliaritySchema, (i) => {
    setVocabFamiliarity(db, i.id, i.familiarity)
  })
  registerHandler(ipc, IPC.vocabDelete, IdSchema, (id) => {
    deleteVocab(db, id)
  })
  registerVoidHandler(ipc, IPC.learningStats, () => learning.stats())
  registerVoidHandler(ipc, IPC.learningProfile, () => learning.profile())
  registerVoidHandler(ipc, IPC.learningAnalyze, () => learning.analyzeProfile())
```

注意 `conversations:end` 只等 `endConversation` 的同步部分会让 IPC 一直挂到小结生成完；改为不等待小结：`(id) => { void learning.endConversation(id) }`。测试只断言 resolve，二者都能过；用不等待的写法。

- [ ] **Step 3: `src/main/index.ts`**

创建 `const learning = new LearningService({ db, ai })`，传入 `registerIpc` 的 services。窗口创建之后在后台跑启动任务，不阻塞界面：

```ts
  // 启动后补跑上次没生成的小结，再按需自动更新画像；都在后台，失败静默
  void (async () => {
    await learning.sweepPendingSummaries()
    await learning.maybeAutoAnalyze()
  })()
```

- [ ] **Step 4: 渲染进程骨架**

`Sidebar.tsx`：`Page` 改为六页联合类型；`ITEMS` 去掉三个 `disabled`；删除"阶段 3 提供"的 title 逻辑。

三个骨架文件（Task 7–9 会整体替换内容，但必须保留导出名与 props）：

```tsx
// MistakesPage.tsx
export function MistakesPage(): React.JSX.Element {
  return <div className="p-6 text-fg-2">错句本</div>
}
// VocabPage.tsx
export function VocabPage(): React.JSX.Element {
  return <div className="p-6 text-fg-2">生词本</div>
}
// AnalysisPage.tsx
export function AnalysisPage({ onStartTargeted }: { onStartTargeted: () => void }): React.JSX.Element {
  return (
    <div className="p-6 text-fg-2">
      学习分析 <button onClick={onStartTargeted}>开始针对性练习</button>
    </div>
  )
}
```

`App.tsx`：导入三页，渲染：

```tsx
          {page === 'mistakes' && <MistakesPage />}
          {page === 'vocab' && <VocabPage />}
          {page === 'analysis' && (
            <AnalysisPage
              onStartTargeted={() => {
                setNewOpen({ mode: 'targeted' })
                setPage('chat')
              }}
            />
          )}
```

`ChatPage.tsx`：在现有"进入 / 离开会话"effect 的 cleanup 末尾加 `void api.conversations.end(id)`（切换会话和离开聊天页都会触发，主进程幂等）。

- [ ] **Step 5: 验证与提交**

Run: `npx vitest run && npm run typecheck`，prettier + eslint 改动文件。`npm run dev:fake`：侧栏六项都可点；在一个会话发 3 条消息后切到另一个会话，再看数据库里该会话的练习记录有 `ended_at` 与小结（Fake 的 `analyzeResult` 是课文结构，不符合小结 schema——**本任务在 `index.ts` 的 Fake 分支里不改它**，小结会静默失败；只确认 `ended_at` 写入：`sqlite3 ~/Library/Application\ Support/my-tutor/my-tutor.db "select conversation_id, ended_at from practice_sessions order by started_at desc limit 3"`）。关闭 dev server。

```bash
git add src/main src/renderer
git commit -m "feat: 学习记录 IPC 与主进程装配，侧栏开放错句本 / 生词本 / 学习分析

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 错句本页面

**Files:**
- Modify: `src/renderer/src/components/MistakesPage.tsx`（替换骨架）

**Interfaces:**
- Consumes：`api.mistakes.list / master / delete`；`CATEGORY_LABEL`；`Mistake`、`MistakeFilter`。
- Produces：`MistakesPage(): JSX.Element`（props 不变）。

需求：
- 顶部：标题"错句本"，右侧显示"待复习 N 条 · 其中到期 M 条"（用 `api.mistakes.list('all')` 与 `list('due')` 的长度）。
- 筛选条（按钮组，单选）：全部、到期复习、语法、用词、地道程度、其他、已掌握；默认"全部"。
- 列表每行：类别标签（`CATEGORY_LABEL`）；状态（已掌握 / 到期复习 / `已复习 n 次 · 下次 MM-DD`）；原句（删除线、红）→ 改为（绿、加粗）；中文解释（`text-zh`）；来源（`conversationId` 为空显示"来源会话已删除"，否则不显示）。
- 操作：未掌握的显示"标记已掌握"；所有行"删除"需要两次点击确认，确认状态绑定到该行 id，2.5 秒后失效，组件卸载时清定时器。操作后重新加载当前筛选和顶部计数。
- 空状态："这个分类下没有错句。和 AI 多聊几轮，纠错会自动收进来。"
- 加载失败显示一行红色提示，不崩。

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mistake, MistakeFilter } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../api'

const FILTERS: Array<{ key: MistakeFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '到期复习' },
  { key: 'grammar', label: '语法' },
  { key: 'word_choice', label: '用词' },
  { key: 'naturalness', label: '地道程度' },
  { key: 'other', label: '其他' },
  { key: 'mastered', label: '已掌握' }
]

const md = (iso: string): string => iso.slice(5, 10)

export function MistakesPage(): React.JSX.Element {
  const [filter, setFilter] = useState<MistakeFilter>('all')
  const [items, setItems] = useState<Mistake[]>([])
  const [counts, setCounts] = useState({ pending: 0, due: 0 })
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(async (f: MistakeFilter) => {
    try {
      const [list, all, due] = await Promise.all([
        api.mistakes.list(f),
        api.mistakes.list('all'),
        api.mistakes.list('due')
      ])
      setItems(list)
      setCounts({ pending: all.length, due: due.length })
      setError(null)
    } catch (e) {
      setError(`加载失败：${String((e as Error)?.message ?? e)}`)
    }
  }, [])

  useEffect(() => {
    void reload(filter)
  }, [filter, reload])
  useEffect(() => () => clearTimeout(timer.current), [])

  const master = async (id: string): Promise<void> => {
    await api.mistakes.master(id)
    await reload(filter)
  }
  const remove = async (id: string): Promise<void> => {
    if (confirmId !== id) {
      clearTimeout(timer.current)
      setConfirmId(id)
      timer.current = setTimeout(() => setConfirmId(null), 2500)
      return
    }
    clearTimeout(timer.current)
    setConfirmId(null)
    await api.mistakes.delete(id)
    await reload(filter)
  }

  const now = new Date().toISOString()
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">错句本</h2>
        <span className="text-xs text-fg-3">
          待复习 {counts.pending} 条 · 其中到期 {counts.due} 条
        </span>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-full border text-xs ${filter === f.key ? 'bg-accent text-white border-transparent' : 'border-line text-fg-2'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-bad">{error}</div>}
        {items.length === 0 && !error && (
          <p className="text-fg-3 text-sm">这个分类下没有错句。和 AI 多聊几轮，纠错会自动收进来。</p>
        )}
        {items.map((m) => (
          <div key={m.id} className="border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start selectable">
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-1.5 rounded-full bg-surface-2 border border-line text-fg-2">{CATEGORY_LABEL[m.category]}</span>
                {m.status === 'mastered' ? (
                  <span className="px-1.5 rounded bg-good-soft text-good">已掌握</span>
                ) : m.nextReviewAt <= now ? (
                  <span className="px-1.5 rounded bg-warn-soft text-warn">到期复习</span>
                ) : (
                  <span className="text-fg-3">已复习 {m.reviewCount} 次 · 下次 {md(m.nextReviewAt)}</span>
                )}
                {m.conversationId === null && <span className="text-fg-3">来源会话已删除</span>}
              </div>
              <div className="text-sm">
                <span className="line-through text-bad">{m.original}</span>
                <span className="text-fg-3 mx-1.5">→</span>
                <span className="text-good font-semibold">{m.improved}</span>
              </div>
              <div className="text-[12.5px] text-zh">{m.explanationZh}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {m.status !== 'mastered' && (
                <button className={btn} onClick={() => void master(m.id)}>
                  标记已掌握
                </button>
              )}
              <button className={`${btn} text-bad`} onClick={() => void remove(m.id)}>
                {confirmId === m.id ? '确认删除？' : '删除'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **验证与提交**

`npm run typecheck`、eslint、prettier；`npm run dev:fake` 中发两条消息（Fake 默认每轮带一个纠错，同一会话同一句只记一条；新建一个会话再发一条会再记一条），打开错句本检查：计数、筛选、标记已掌握后移到"已掌握"、删除两次确认、删除来源会话后显示"来源会话已删除"。关闭 dev server。

```bash
git add src/renderer/src/components/MistakesPage.tsx
git commit -m "feat: 错句本页面（筛选、到期提示、标记已掌握、删除）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 生词本页面

**Files:**
- Modify: `src/renderer/src/components/VocabPage.tsx`（替换骨架）

**Interfaces:**
- Consumes：`api.vocab.list / setFamiliarity / delete`；`VocabEntry`。
- Produces：`VocabPage(): JSX.Element`。

需求：
- 顶部：标题"生词本"、搜索框（`id="vocab-search"`，输入后 250 ms 防抖再查询）、右侧"共 N 个 · 已掌握 M 个"（熟悉度 5 为已掌握）。
- 每行：单词（加粗）、中文释义（`text-zh`）、例句（斜体灰）、来源（`来自会话` / `来自课程` / 来源已删除时 `来源已删除`）、见过次数 `见过 n 次`。
- 熟悉度：6 个圆点（0–5 中 1–5 五个点 + 一个"重置"不必要；做法：5 个点，点第 k 个设为 k，点当前值的同一个点设回 k-1），`title="熟悉度 n/5"`；"已掌握"按钮设为 5（已是 5 时不显示）。
- 删除：两次点击确认，确认绑定行 id，2.5 秒失效，卸载清定时器。
- 空状态："还没有生词。聊天和课程里出现的生词会自动收进来。"；搜索无结果："没有找到「xxx」。"
- 加载失败一行红色提示。

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabEntry } from '@shared/types'
import { api } from '../api'

export function VocabPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<VocabEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(async (q: string) => {
    try {
      setItems(await api.vocab.list(q))
      setError(null)
    } catch (e) {
      setError(`加载失败：${String((e as Error)?.message ?? e)}`)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void reload(query), 250)
    return () => clearTimeout(t)
  }, [query, reload])
  useEffect(() => () => clearTimeout(timer.current), [])

  const setFam = async (v: VocabEntry, f: number): Promise<void> => {
    await api.vocab.setFamiliarity(v.id, f)
    await reload(query)
  }
  const remove = async (id: string): Promise<void> => {
    if (confirmId !== id) {
      clearTimeout(timer.current)
      setConfirmId(id)
      timer.current = setTimeout(() => setConfirmId(null), 2500)
      return
    }
    clearTimeout(timer.current)
    setConfirmId(null)
    await api.vocab.delete(id)
    await reload(query)
  }

  const mastered = items.filter((v) => v.familiarity >= 5).length
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">生词本</h2>
        <input
          id="vocab-search"
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm w-48 selectable"
          placeholder="搜索单词或释义"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-fg-3">
          共 {items.length} 个 · 已掌握 {mastered} 个
        </span>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2.5">
        {error && <div className="text-xs text-bad">{error}</div>}
        {items.length === 0 && !error && (
          <p className="text-fg-3 text-sm">
            {query.trim() ? `没有找到「${query.trim()}」。` : '还没有生词。聊天和课程里出现的生词会自动收进来。'}
          </p>
        )}
        {items.map((v) => (
          <div key={v.id} className="border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start selectable">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <b>{v.word}</b>
                <span className="text-zh text-sm">{v.meaningZh}</span>
                <span className="inline-flex gap-1" title={`熟悉度 ${v.familiarity}/5`}>
                  {[1, 2, 3, 4, 5].map((k) => (
                    <button
                      key={k}
                      aria-label={`熟悉度设为 ${k}`}
                      onClick={() => void setFam(v, v.familiarity === k ? k - 1 : k)}
                      className={`w-2.5 h-2.5 rounded-full ${k <= v.familiarity ? 'bg-accent' : 'bg-line'}`}
                    />
                  ))}
                </span>
              </div>
              {v.example && <div className="italic text-fg-2 text-[12.5px]">{v.example}</div>}
              <div className="text-[11.5px] text-fg-3">
                {v.sourceId === null ? '来源已删除' : v.source === 'lesson' ? '来自课程' : '来自会话'} · 见过 {v.seenCount} 次
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {v.familiarity < 5 && (
                <button className={btn} onClick={() => void setFam(v, 5)}>
                  已掌握
                </button>
              )}
              <button className={`${btn} text-bad`} onClick={() => void remove(v.id)}>
                {confirmId === v.id ? '确认删除？' : '删除'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **验证与提交**

`npm run typecheck`、eslint、prettier；`npm run dev:fake` 中聊两轮（Fake 每轮带生词 commute，见过次数应递增），再从文本新建一篇课程（Fake 的课文生词 morning），打开生词本检查搜索（中英文都能搜）、熟悉度点击、已掌握、删除确认、来源显示。关闭 dev server。

```bash
git add src/renderer/src/components/VocabPage.tsx
git commit -m "feat: 生词本页面（搜索、熟悉度、已掌握、删除）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 学习分析页、开放针对性练习、dev:fake 的分析假数据

**Files:**
- Modify: `src/renderer/src/components/AnalysisPage.tsx`（替换骨架）、`src/renderer/src/components/NewConversationDialog.tsx`
- Modify: `src/main/ai/fake.ts`（+测试）、`src/main/index.ts`（Fake 分支）

**Interfaces:**
- Consumes：`api.learning.stats / profile / analyze`；`LearningStats`、`LearnerProfile`、`CATEGORY_LABEL`。
- Produces：`AnalysisPage({ onStartTargeted })`；`FakeAIOptions.analyzeCandidates?: unknown[]`。

- [ ] **Step 1: Fake 支持多份分析结果（先写测试）**

`src/main/ai/fake.test.ts` 加：

```ts
  it('analyze picks the first candidate that matches the requested schema', async () => {
    const fake = new FakeAIProvider({
      analyzeCandidates: [
        { title: 'L', body: 'b', vocabulary: [], notesZh: '' },
        { practiced: '点餐', performanceZh: '好', issues: [] }
      ]
    })
    expect(await fake.analyze({ systemPrompt: 's', text: 't', schema: SessionSummarySchema })).toEqual({ practiced: '点餐', performanceZh: '好', issues: [] })
    expect((await fake.analyze({ systemPrompt: 's', text: 't', schema: LessonExtractionSchema })).title).toBe('L')
  })
```

（导入 `SessionSummarySchema`。）实现：`analyze` 先看 `analyzeCandidates`，返回第一个 `schema.safeParse` 成功的；都不匹配或未提供时退回原有 `analyzeResult` 逻辑。

`src/main/index.ts` 的 Fake 分支改为传 `analyzeCandidates: [课文对象（原 analyzeResult）, { practiced: '日常对话练习', performanceZh: '整体表达清楚，过去式偶有错误。', issues: ['不规则动词过去式'] }, { level: 'B1', weaknesses: ['不规则动词过去式', '冠词 a/the', '工作会议表达'], progress: ['句子更完整'], suggestions: ['用针对性练习连做三次过去式对话'], summaryZh: '能应付日常场景，主要问题在过去式和冠词。' }]`，删除 `analyzeResult`。

- [ ] **Step 2: 学习分析页 `AnalysisPage.tsx`**

需求：
- 顶部：标题"学习分析"；"上次分析：MM-DD HH:mm"（无画像时"还没有分析过"）；按钮"更新分析"（进行中显示转圈与"分析中…"并禁用；失败把 `message` 显示在页内红色提示）；主按钮"开始针对性练习"调用 `onStartTargeted`。
- 画像卡（有画像时）：大号水平（如 `B1`），中文总结；薄弱点（chip 列表）；近期进步（列表，空则"暂无"）；建议（列表）。
- 无画像时：一张说明卡"还没有学习画像。和 AI 练几轮后点「更新分析」，会根据你的错句、生词和练习小结生成。"
- 统计卡：待复习错句按类别四行 + 到期数 + 已掌握数；生词总数与熟悉度分布（0–5 六个数字，用简单横条表示，宽度按占比）；练习次数 / 总轮数。数字 `tabular-nums`。
- 挂载时并行加载 `stats` 与 `profile`；更新分析成功后重新加载两者。

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { LearnerProfile, LearningStats } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { api } from '../api'

const fmt = (iso: string): string => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`

export function AnalysisPage({ onStartTargeted }: { onStartTargeted: () => void }): React.JSX.Element {
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [profile, setProfile] = useState<LearnerProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.learning.stats(), api.learning.profile()])
      setStats(s)
      setProfile(p)
    } catch (e) {
      setError(`加载失败：${String((e as Error)?.message ?? e)}`)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const analyze = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.learning.analyze()
      if (r.ok) await load()
      else setError(r.message)
    } catch (e) {
      setError(`分析失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  const card = 'border border-line rounded-lg px-4 py-3.5 flex flex-col gap-2'
  const famTotal = stats ? Math.max(1, stats.vocabTotal) : 1
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line flex-wrap">
        <h2 className="text-[15px] font-semibold flex-1">学习分析</h2>
        <span className="text-xs text-fg-3">{profile ? `上次分析：${fmt(profile.updatedAt)}` : '还没有分析过'}</span>
        <button className="text-xs px-2 py-1 rounded-md border border-line disabled:opacity-50" disabled={busy} onClick={() => void analyze()}>
          {busy ? (
            <>
              <span className="inline-block w-3 h-3 mr-1 align-[-2px] rounded-full border-2 border-line border-t-accent animate-spin" />
              分析中…
            </>
          ) : (
            '更新分析'
          )}
        </button>
        <button className="text-xs px-2.5 py-1 rounded-md bg-accent text-white" onClick={onStartTargeted}>
          开始针对性练习
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-3.5 content-start">
        {error && <div className="lg:col-span-2 text-xs text-bad">{error}</div>}
        {profile ? (
          <>
            <section className={card}>
              <div className="text-3xl font-bold text-accent leading-none">
                {profile.level}
                <span className="text-xs font-normal text-fg-2 ml-2">估计水平（CEFR）</span>
              </div>
              <p className="text-zh text-sm m-0 selectable">{profile.summaryZh}</p>
            </section>
            <section className={card}>
              <h3 className="text-sm font-semibold m-0">薄弱点</h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.weaknesses.length ? (
                  profile.weaknesses.map((w) => (
                    <span key={w} className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs">
                      {w}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-fg-3">暂无</span>
                )}
              </div>
              <h3 className="text-sm font-semibold m-0 mt-2">近期进步</h3>
              {profile.progress.length ? (
                <ul className="m-0 pl-4 text-sm">{profile.progress.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <span className="text-xs text-fg-3">暂无</span>
              )}
            </section>
            <section className={card}>
              <h3 className="text-sm font-semibold m-0">建议</h3>
              <ul className="m-0 pl-4 text-sm">{profile.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          </>
        ) : (
          <section className={`${card} lg:col-span-2`}>
            <p className="text-sm text-fg-2 m-0">
              还没有学习画像。和 AI 练几轮后点「更新分析」，会根据你的错句、生词和练习小结生成。
            </p>
          </section>
        )}
        {stats && (
          <section className={card}>
            <h3 className="text-sm font-semibold m-0">统计</h3>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              {(Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>).map((c) => (
                <span key={c} className="contents">
                  <span>待复习 · {CATEGORY_LABEL[c]}</span>
                  <span className="text-right font-semibold">{stats.mistakesByCategory[c]}</span>
                </span>
              ))}
              <span>其中到期</span>
              <span className="text-right font-semibold">{stats.mistakesDue}</span>
              <span>已掌握错句</span>
              <span className="text-right font-semibold">{stats.mistakesMastered}</span>
              <span>生词总数</span>
              <span className="text-right font-semibold">{stats.vocabTotal}</span>
              <span>练习次数 / 总轮数</span>
              <span className="text-right font-semibold">
                {stats.sessions} / {stats.totalTurns}
              </span>
            </div>
            <div className="flex flex-col gap-1 mt-1">
              {stats.vocabByFamiliarity.map((n, f) => (
                <div key={f} className="flex items-center gap-2 text-xs tabular-nums">
                  <span className="w-14 text-fg-3">熟悉度 {f}</span>
                  <span className="flex-1 h-1.5 rounded bg-line overflow-hidden">
                    <span className="block h-full bg-accent" style={{ width: `${(n / famTotal) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right">{n}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 开放针对性练习（`NewConversationDialog.tsx`）**

`MODES` 里 `targeted` 去掉 `disabled`，hint 改为"按薄弱点和到期错句出题"。选中 targeted 时显示说明块：挂载 / 打开时用 `api.learning.profile()` 与 `api.mistakes.list('due')` 取数据，文本为"本次练习：{前 3 个薄弱点用顿号连接，或"还没有学习画像"} · 到期错句 {min(due, 5)} 条"；两者都为空时追加一行灰字"没有记录时会做一般性复习"。`canStart` 对 targeted 不加额外条件。

- [ ] **Step 4: 验证与提交**

`npx vitest run`、`npm run typecheck`、eslint、prettier。`npm run dev:fake`：
1. 在一个会话里发 3 条消息，切到另一个会话（触发小结，Fake 返回小结），学习分析页统计里练习次数和轮数正确。
2. 点"更新分析"→ 显示 B1、薄弱点、建议，"上次分析"时间更新。
3. 点"开始针对性练习"→ 新建会话弹窗预选针对性练习，说明块显示薄弱点和到期错句数，开始后会话标题为"针对性练习"。
4. 新库无数据时点"更新分析"→ 页内提示"还没有足够的练习数据…"，不调用 Claude（用一个临时 userData：`npm run dev:fake -- --user-data-dir=/tmp/my-tutor-empty` 或在报告中说明如何构造空库）。
关闭 dev server。

```bash
git add src/renderer src/main/ai/fake.ts src/main/ai/fake.test.ts src/main/index.ts
git commit -m "feat: 学习分析页、开放针对性练习，dev:fake 提供小结与画像假数据

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 阶段 3 验收（真实 Claude）

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-speakmate-design.md`（第 2 节追加一行）

- [ ] **Step 1: 真实闭环**（`npm run dev`，每步一次，控制调用次数）

1. 新建"自由聊天"，发 3 条含错误的英文（例如 "Yesterday I goed to the park and buyed an ice cream."、"She don't like coffee."、"I have went there two times."）；确认每轮纠错卡出现，错句本出现对应条目（不重复），生词本出现推荐词。
2. 切到另一个会话：后台生成小结（等待几秒后在学习分析页看到练习次数 +1；或查库 `practice_sessions.summary_json`）。记录小结内容是否贴合对话。
3. 学习分析页点"更新分析"：记录耗时、水平、薄弱点、建议是否与刚才的错误对应。
4. 点"开始针对性练习"：开场白是否在引导练薄弱点（例如过去式）；聊 2 轮后切走，确认用到的到期错句复习次数 +1（新错句当天不到期，可把一条错句的 `next_review_at` 手工改到过去来验证：`sqlite3 <db> "update mistakes set next_review_at='2020-01-01T00:00:00.000Z' where rowid=1"`，并在报告中说明）。
5. 新建任意模式会话：确认系统提示带了画像摘要（看 `~/.claude/projects/<encoded claude-sessions 路径>/<会话id>.jsonl` 首条 system 内容，或在报告中说明无法直接查看时以 AI 回复的难度和关注点间接判断）。
6. 重启应用：错句、生词、画像、统计都在；启动后台不报错。

- [ ] **Step 2: 写回 spec 第 2 节**

```md
- 2026-MM-DD 阶段 3 验收：3 轮对话记录错句 <n> 条、生词 <m> 个（无重复）；小结生成 <N> s，内容 <贴合 / 问题>；画像分析 <N> s，水平 <X>，薄弱点 <列出>；针对性练习开场 <是否引导薄弱点>，结束后到期错句复习次数推进 <是>；新会话注入画像 <是 / 判断依据>；重启数据保留 <是>。问题：<无 / 列出>。
```

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs
git commit -m "docs: 阶段 3 学习记录与画像验收结论

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准（M3）

对照 spec 第 12 节阶段 3 验收："几次练习后分析页有画像；针对性练习会引出薄弱点；错句可复习与标记"，以及第 1.1 节第 6 条。剩余的阶段 4（稳定与打包）另出计划。
