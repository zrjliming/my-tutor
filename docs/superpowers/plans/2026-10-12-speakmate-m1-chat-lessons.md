# SpeakMate M1（阶段 0 + 阶段 1：文字聊天 + 课程）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出能跑的第一个里程碑：Electron 桌面应用里新建会话、与 Claude（经本机已登录的 Claude Code）连续文字对话、每轮拿到纠错和生词、把课文图片或文本识别成课程并围绕课程对话，所有数据落 SQLite，重启后仍在。

**Architecture:** 三进程边界：渲染进程（React）只通过 preload 暴露的 `window.speakmate` 调主进程；主进程里 `ChatService` / `LessonService` 组织业务，依赖 `AIProvider` 接口（实现为 `ClaudeCliProvider`，经 Agent SDK 驱动 `claude` 子进程）和 `node:sqlite` 数据层。AI 流式片段经单向事件通道 `chat:event` 推回渲染进程。每个会话对应一个 Claude 会话 UUID，首轮带系统提示，后续 `resume`。

**Tech Stack:** electron-vite 5 + Electron 39 + React 19 + TypeScript 5.9 + Vite 7；Tailwind CSS 4（`@tailwindcss/vite`）；zod 4；`@anthropic-ai/claude-agent-sdk` 0.3.296（固定版本）；`node:sqlite`；Vitest 5；npm。

**Spec:** `docs/superpowers/specs/2026-10-12-speakmate-design.md`（本计划覆盖 spec 第 12 节的阶段 0 和阶段 1；阶段 2 语音、阶段 3 学习记录与画像、阶段 4 打包各自另出计划）。

## Global Constraints

- 目标平台 macOS Apple Silicon；本机 Node 24、npm 11、无 pnpm；`claude` 2.1.296 已登录。
- Agent SDK 固定 `0.3.296`（内置 CLI 版本与本机一致）；每次调用必须：自定义 `systemPrompt`、`settingSources: []`、`tools: []`、`permissionMode: 'dontAsk'`、`cwd` 指向 `userData/claude-sessions/`、`env` 显式传入并删掉 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`。**禁止传 `disallowedTools: ['*']`**（会禁掉 StructuredOutput 工具）。
- 渲染进程：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，不暴露 `ipcRenderer`，所有 IPC 入参经 zod 校验。
- 图片：`image/jpeg` | `image/png` | `image/webp`，单张 base64 ≤ 2,100,000 字符（约 1.5 MB），最多 4 张；渲染进程压缩到长边 ≤ 1600 px 再发。
- 第一版学习模式：`free` | `lesson` | `roleplay` | `scenario` | `targeted`；M1 实现前四个，`targeted` 在新建弹窗里显示但禁用（阶段 3）。
- 数据库文件 `userData/speakmate.db`，WAL，`PRAGMA user_version` 编号迁移，只追加。
- 提交信息用中文，结尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- UI 文案中文；AI 对话英文，解释中文。

## Review Focus

1. **一轮未结束再发送**：同一会话 streaming 中再次 `chat.send`，服务必须拒绝并报"上一轮尚未结束"，UI 的发送键应已变成停止。测试在 Task 7（`ChatService` "second send while active rejects"）。
2. **开场轮失败后会话仍可用**：新建会话时 Claude 未登录导致开场失败，下一次发送必须重新作为首轮（带系统提示、`sessionId`），不能 `resume` 一个不存在的会话。测试在 Task 7（`session_started` 为 0 时 `firstTurn` 为 true）。
3. **结构化输出缺失**：result 里没有 `structured_output` 或校验失败时，回复以纯文本显示、不显示纠错卡、消息状态仍为 `done`。测试在 Task 5（provider）和 Task 7（service 落库 `structured` 为 null）。
4. **图片越界**：超过 4 张、MIME 不在白名单、base64 超长，必须在 IPC 校验层被拒，不能到 Claude。测试在 Task 2（schema）。
5. **从 Finder 启动的最简环境**：`PATH` 不含 `/opt/homebrew/bin`、环境里残留 `ANTHROPIC_API_KEY` 时，子进程 env 必须补 PATH 并删除 Key 变量，否则订阅登录被绕过或找不到 whisper。测试在 Task 5（`cleanEnv`）。

---

## 文件结构

```
my-tutor/
  package.json  electron.vite.config.ts  vitest.config.ts  electron-builder.yml
  tsconfig.json  tsconfig.node.json  tsconfig.web.json
  src/shared/
    schemas.ts        zod：TutorResponse / LessonExtraction / 各 IPC 入参
    types.ts          由 schema 推导的类型 + Conversation / Message / Lesson / AppSettings / ChatEvent
    ipc.ts            IPC 通道名常量 + SpeakMateAPI 接口
  src/main/
    index.ts          app 生命周期、窗口、注册 IPC
    window.ts         createWindow（安全配置、CSP、导航拦截）
    paths.ts          userData 下各目录
    env.d.ts          `*.md?raw` 声明
    ai/types.ts       AIProvider / ChatRequest / AnalyzeRequest / AIError
    ai/fake.ts        FakeAIProvider（测试与 UI 开发）
    ai/claude-cli.ts  ClaudeCliProvider（Agent SDK）
    ai/env.ts         cleanEnv
    ai/json-schema.ts zod → draft-7
    db/index.ts       openDatabase / migrate
    db/migrations.ts  MIGRATIONS 数组
    db/conversations.ts  db/messages.ts  db/lessons.ts  db/settings.ts
    learning/prompts.ts  buildSystemPrompt
    prompts/base-tutor.md  free-chat.md  lesson-qa.md  role-play.md  scenario-task.md  extract-lesson.md
    chat/service.ts   ChatService
    lessons/service.ts LessonService
    ipc/handle.ts     registerHandler（zod 校验包装）
    ipc/register.ts   把所有通道接到服务
  src/preload/index.ts  index.d.ts
  src/renderer/src/
    main.tsx  App.tsx  index.css
    api.ts
    state/machine.ts         UI 状态机（纯函数）
    state/chatReducer.ts     会话 / 消息 / 事件应用（纯函数）
    store/ChatStore.tsx      Context + 副作用
    lib/image.ts             压缩图片
    components/Sidebar.tsx ChatPage.tsx ConversationList.tsx MessageList.tsx
               MessageBubble.tsx CorrectionCard.tsx VocabChips.tsx InputBar.tsx
               NewConversationDialog.tsx LessonDialog.tsx LessonsPage.tsx SettingsPage.tsx
  scripts/probe-whisper.sh
```

---

### Task 1: 脚手架与安全基线

**Files:**
- Create: 整个 electron-vite 工程（由脚手架生成后拷入仓库根目录）
- Modify: `package.json`、`electron.vite.config.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/index.html`
- Create: `vitest.config.ts`、`src/renderer/src/index.css`

**Interfaces:**
- Produces: 可运行的 `npm run dev`、`npm run typecheck`、`npm test`；主进程 `createWindow()` 在 `src/main/window.ts`（Task 9 会替换 `index.ts` 的内容）。

- [ ] **Step 1: 生成脚手架并拷入仓库**

```bash
cd /tmp && rm -rf speakmate-tmp && npm create @quick-start/electron@latest speakmate-tmp -- --template react-ts --skip
cd /Users/zhouruijie/daypop/code/server/my-tutor
rsync -a --exclude node_modules /tmp/speakmate-tmp/ ./
rm -rf src/renderer/src/components/Versions.tsx src/renderer/src/assets/wavy-lines.svg src/renderer/src/assets/electron.svg src/renderer/src/assets/main.css src/renderer/src/assets/base.css
```

- [ ] **Step 2: 改 package.json**

把 `name` 改为 `speakmate`，`description` 改为 `AI 英语陪练`，`author` 改为 `ruijie.zhou`。`scripts` 增加：

```json
"test": "vitest run",
"test:watch": "vitest",
"dev:fake": "SPEAKMATE_FAKE_AI=1 electron-vite dev"
```

去掉 `postinstall`（没有原生模块）。安装依赖：

```bash
npm install
npm install zod@^4.3.3 @anthropic-ai/claude-agent-sdk@0.3.296 --save-exact
npm install -D tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 vitest@^5.0.4
```

- [ ] **Step 3: electron.vite.config.ts**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

- [ ] **Step 4: vitest.config.ts**

```ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node'
  }
})
```

- [ ] **Step 5: tsconfig 路径与 shared 目录**

`tsconfig.node.json` 的 `include` 加 `"src/shared/**/*"`，`compilerOptions` 加：

```json
"baseUrl": ".",
"paths": { "@shared/*": ["src/shared/*"] }
```

`tsconfig.web.json` 的 `include` 加 `"src/shared/**/*"`，`paths` 加 `"@shared/*": ["src/shared/*"]`。

- [ ] **Step 6: 安全基线的窗口文件 `src/main/window.ts`**

```ts
import { BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export function installCsp(): void {
  const devExtra = is.dev ? ' http://localhost:* ws://localhost:*' : ''
  const csp = [
    `default-src 'self'`,
    `script-src 'self'${devExtra}`,
    `style-src 'self' 'unsafe-inline'${devExtra}`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'${devExtra}`,
    `font-src 'self' data:`,
    `media-src 'self' blob:`
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = is.dev ? process.env['ELECTRON_RENDERER_URL'] ?? '' : 'file://'
    if (!url.startsWith(allowed)) event.preventDefault()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
```

- [ ] **Step 7: 临时的 `src/main/index.ts`（Task 9 会重写）**

```ts
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow, installCsp } from './window'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.speakmate.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  installCsp()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 8: 临时 preload 与渲染入口**

`src/preload/index.ts`：

```ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('speakmate', {})
```

`src/preload/index.d.ts`：

```ts
export {}
declare global {
  interface Window {
    speakmate: unknown
  }
}
```

`src/renderer/src/index.css`：

```css
@import 'tailwindcss';

@theme {
  --color-bg: #eaf0f8;
  --color-surface: #ffffff;
  --color-surface-2: #f3f7fc;
  --color-line: #d8e2ee;
  --color-fg: #182230;
  --color-fg-2: #52627a;
  --color-fg-3: #8696ad;
  --color-accent: #1b6fe0;
  --color-accent-soft: #e3eefc;
  --color-ai-bubble: #eef3f9;
  --color-good: #2e7d4f;
  --color-good-soft: #e3f3ea;
  --color-warn: #9a6a00;
  --color-warn-soft: #fff4d6;
  --color-bad: #b3382c;
  --color-bad-soft: #fbe6e3;
  --color-zh: #6b5a2a;
  --font-sans: -apple-system, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-mono: 'SF Mono', Menlo, Consolas, monospace;
}

html, body, #root { height: 100%; margin: 0; }
body { font-family: var(--font-sans); font-size: 13.5px; color: var(--color-fg); background: var(--color-surface); -webkit-user-select: none; user-select: none; }
textarea, input, .selectable { -webkit-user-select: text; user-select: text; }
```

`src/renderer/src/App.tsx`：

```tsx
export default function App(): React.JSX.Element {
  return <div className="h-full flex items-center justify-center text-fg-2">SpeakMate</div>
}
```

`src/renderer/src/main.tsx`：

```tsx
import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/index.html` 里删掉模板自带的 `<meta http-equiv="Content-Security-Policy" ...>`（CSP 由主进程响应头统一设置），其余保留。

- [ ] **Step 9: 验证**

```bash
npm run typecheck
npx vitest run --passWithNoTests
npm run dev
```

Expected: typecheck 无错误；vitest 退出码 0；窗口弹出并居中显示 "SpeakMate"，开发者工具 Console 无 CSP 报错。关掉窗口。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "chore: electron-vite 脚手架、Tailwind、Vitest 与安全基线

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 共享 schema 与类型

**Files:**
- Create: `src/shared/schemas.ts`、`src/shared/types.ts`、`src/shared/ipc.ts`
- Test: `src/shared/schemas.test.ts`

**Interfaces:**
- Produces: 下列导出，后续所有任务按名引用。

```ts
// schemas.ts
export const ModeSchema, DifficultySchema, CorrectionCategorySchema, ImageMimeSchema
export const TutorResponseSchema, LessonExtractionSchema
export const CreateConversationInputSchema, SendMessageInputSchema, ConversationIdSchema
export const ImageInputSchema, ExtractLessonInputSchema, SaveLessonInputSchema
export const SettingsPatchSchema
// types.ts
export type Mode, Difficulty, TutorResponse, LessonExtraction, ImageInput, CreateConversationInput,
  SendMessageInput, ExtractLessonInput, SaveLessonInput, SettingsPatch
export interface Conversation, Message, Lesson, LessonAsset, AppSettings, AICheckResult
export type AIErrorKind, ChatEvent, ChatIpcEvent, MessageStatus
export const DEFAULT_SETTINGS: AppSettings
export const MODE_LABEL: Record<Mode, string>
// ipc.ts
export const IPC = {...} as const
export interface SpeakMateAPI
```

- [ ] **Step 1: 写失败的测试 `src/shared/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  TutorResponseSchema,
  LessonExtractionSchema,
  ExtractLessonInputSchema,
  SendMessageInputSchema,
  CreateConversationInputSchema
} from './schemas'

const img = (n = 1): { mime: 'image/png'; base64: string } => ({ mime: 'image/png', base64: 'A'.repeat(n) })

describe('TutorResponseSchema', () => {
  it('accepts a minimal reply', () => {
    expect(TutorResponseSchema.safeParse({ reply: 'Hi!' }).success).toBe(true)
  })
  it('rejects empty reply and unknown category', () => {
    expect(TutorResponseSchema.safeParse({ reply: '' }).success).toBe(false)
    expect(
      TutorResponseSchema.safeParse({
        reply: 'x',
        correction: { original: 'a', improved: 'b', explanationZh: 'c', category: 'spelling' }
      }).success
    ).toBe(false)
  })
  it('caps vocabulary at 3', () => {
    const v = { word: 'w', meaningZh: 'm', example: 'e' }
    expect(TutorResponseSchema.safeParse({ reply: 'x', vocabulary: [v, v, v] }).success).toBe(true)
    expect(TutorResponseSchema.safeParse({ reply: 'x', vocabulary: [v, v, v, v] }).success).toBe(false)
  })
})

describe('LessonExtractionSchema', () => {
  it('requires title and body', () => {
    expect(LessonExtractionSchema.safeParse({ title: 'L5', body: 'text', vocabulary: [], notesZh: '' }).success).toBe(true)
    expect(LessonExtractionSchema.safeParse({ title: '', body: 'text', vocabulary: [], notesZh: '' }).success).toBe(false)
  })
})

describe('ExtractLessonInputSchema', () => {
  it('needs images or text', () => {
    expect(ExtractLessonInputSchema.safeParse({}).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ text: 'Hello' }).success).toBe(true)
    expect(ExtractLessonInputSchema.safeParse({ images: [img()] }).success).toBe(true)
  })
  it('rejects more than 4 images, bad mime, oversized base64', () => {
    expect(ExtractLessonInputSchema.safeParse({ images: [img(), img(), img(), img(), img()] }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ images: [{ mime: 'image/gif', base64: 'A' }] }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ images: [img(2_100_001)] }).success).toBe(false)
    expect(ExtractLessonInputSchema.safeParse({ images: [img(2_100_000)] }).success).toBe(true)
  })
})

describe('SendMessageInputSchema / CreateConversationInputSchema', () => {
  it('trims and bounds text, requires uuid', () => {
    const id = '7d2f3a4e-1b2c-4d5e-8f90-123456789abc'
    expect(SendMessageInputSchema.parse({ conversationId: id, text: '  hi ' }).text).toBe('hi')
    expect(SendMessageInputSchema.safeParse({ conversationId: 'nope', text: 'hi' }).success).toBe(false)
    expect(SendMessageInputSchema.safeParse({ conversationId: id, text: ' ' }).success).toBe(false)
  })
  it('validates mode', () => {
    expect(CreateConversationInputSchema.safeParse({ mode: 'free' }).success).toBe(true)
    expect(CreateConversationInputSchema.safeParse({ mode: 'karaoke' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/schemas.test.ts`
Expected: FAIL，提示找不到 `./schemas`。

- [ ] **Step 3: 写 `src/shared/schemas.ts`**

```ts
import { z } from 'zod'

export const ModeSchema = z.enum(['free', 'lesson', 'roleplay', 'scenario', 'targeted'])
export const DifficultySchema = z.enum(['beginner', 'intermediate', 'advanced'])
export const CorrectionCategorySchema = z.enum(['grammar', 'word_choice', 'naturalness', 'other'])
export const ImageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

const VocabItemSchema = z.object({
  word: z.string().min(1),
  meaningZh: z.string(),
  example: z.string()
})

export const TutorResponseSchema = z.object({
  reply: z.string().min(1),
  correction: z
    .object({
      original: z.string(),
      improved: z.string(),
      explanationZh: z.string(),
      category: CorrectionCategorySchema,
      uncertain: z.boolean().optional()
    })
    .optional(),
  vocabulary: z.array(VocabItemSchema).max(3).optional(),
  nextAction: z.string().optional(),
  taskCompleted: z.boolean().optional()
})

export const LessonExtractionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  vocabulary: z.array(VocabItemSchema).max(15),
  notesZh: z.string()
})

export const ConversationIdSchema = z.string().uuid()

export const CreateConversationInputSchema = z.object({
  mode: ModeSchema,
  lessonId: z.string().uuid().optional(),
  scenario: z.string().min(1).max(40).optional()
})

export const SendMessageInputSchema = z.object({
  conversationId: ConversationIdSchema,
  text: z.string().trim().min(1).max(4000),
  fromAsr: z.boolean().optional()
})

export const ImageInputSchema = z.object({
  mime: ImageMimeSchema,
  base64: z.string().min(1).max(2_100_000),
  name: z.string().max(200).optional()
})

export const ExtractLessonInputSchema = z
  .object({
    images: z.array(ImageInputSchema).max(4).optional(),
    text: z.string().max(20_000).optional()
  })
  .refine((v) => (v.images?.length ?? 0) > 0 || (v.text?.trim().length ?? 0) > 0, {
    message: '需要图片或文本'
  })

export const SaveLessonInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  notesZh: z.string().max(4000),
  vocabulary: z.array(VocabItemSchema).max(30),
  source: z.enum(['image', 'text']),
  images: z.array(ImageInputSchema).max(4).optional()
})

export const SettingsPatchSchema = z.object({
  model: z.string().max(50).optional(),
  difficulty: DifficultySchema.optional(),
  chineseExplanations: z.boolean().optional(),
  autoSpeak: z.boolean().optional()
})
```

- [ ] **Step 4: 写 `src/shared/types.ts`**

```ts
import type { z } from 'zod'
import type {
  ModeSchema,
  DifficultySchema,
  TutorResponseSchema,
  LessonExtractionSchema,
  ImageInputSchema,
  CreateConversationInputSchema,
  SendMessageInputSchema,
  ExtractLessonInputSchema,
  SaveLessonInputSchema,
  SettingsPatchSchema
} from './schemas'

export type Mode = z.infer<typeof ModeSchema>
export type Difficulty = z.infer<typeof DifficultySchema>
export type TutorResponse = z.infer<typeof TutorResponseSchema>
export type LessonExtraction = z.infer<typeof LessonExtractionSchema>
export type ImageInput = z.infer<typeof ImageInputSchema>
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>
export type ExtractLessonInput = z.infer<typeof ExtractLessonInputSchema>
export type SaveLessonInput = z.infer<typeof SaveLessonInputSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const MODE_LABEL: Record<Mode, string> = {
  free: '自由聊天',
  lesson: '课文问答',
  roleplay: '角色扮演',
  scenario: '场景任务',
  targeted: '针对性练习'
}

export interface Conversation {
  id: string
  title: string
  mode: Mode
  lessonId: string | null
  scenario: string | null
  turnCount: number
  sessionStarted: boolean
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  structured: TutorResponse | null
  status: MessageStatus
  fromAsr: boolean
  createdAt: string
}

export interface LessonAsset {
  id: string
  lessonId: string
  path: string
  mime: string
  size: number
}

export interface Lesson {
  id: string
  title: string
  body: string
  source: 'image' | 'text'
  notesZh: string
  vocabulary: Array<{ word: string; meaningZh: string; example: string }>
  createdAt: string
  assets: LessonAsset[]
}

export interface AppSettings {
  model: string
  difficulty: Difficulty
  chineseExplanations: boolean
  autoSpeak: boolean
  voice: string
  rate: number
  whisperBinaryPath: string
  whisperModelPath: string
  lastProfileAnalysisAt: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: '',
  difficulty: 'intermediate',
  chineseExplanations: true,
  autoSpeak: true,
  voice: 'Samantha',
  rate: 175,
  whisperBinaryPath: '/opt/homebrew/bin/whisper-cli',
  whisperModelPath: '',
  lastProfileAnalysisAt: null
}

export type AIErrorKind = 'not_logged_in' | 'binary_missing' | 'network' | 'rate_limited' | 'aborted' | 'unknown'

export type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; structured?: TutorResponse; rawText: string }
  | { type: 'retrying'; attempt: number }
  | { type: 'error'; kind: AIErrorKind; message: string }

export type ChatIpcEvent = ChatEvent & { conversationId: string; messageId: string }

export interface AICheckResult {
  ok: boolean
  model?: string
  durationMs?: number
  message: string
}
```

- [ ] **Step 5: 写 `src/shared/ipc.ts`**

```ts
import type {
  AICheckResult,
  AppSettings,
  ChatIpcEvent,
  Conversation,
  CreateConversationInput,
  ExtractLessonInput,
  ImageInput,
  Lesson,
  LessonExtraction,
  Message,
  SaveLessonInput,
  SendMessageInput,
  SettingsPatch
} from './types'

export const IPC = {
  conversationsList: 'conversations:list',
  conversationsCreate: 'conversations:create',
  conversationsDelete: 'conversations:delete',
  messagesList: 'messages:list',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  lessonsList: 'lessons:list',
  lessonsExtract: 'lessons:extract',
  lessonsSave: 'lessons:save',
  lessonsDelete: 'lessons:delete',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  aiCheck: 'ai:check',
  imagePick: 'image:pick'
} as const

export interface SpeakMateAPI {
  conversations: {
    list(): Promise<Conversation[]>
    create(input: CreateConversationInput): Promise<{ conversation: Conversation; assistantMessageId: string }>
    delete(id: string): Promise<void>
  }
  messages: {
    list(conversationId: string): Promise<Message[]>
  }
  chat: {
    send(input: SendMessageInput): Promise<{ userMessage: Message; assistantMessageId: string }>
    cancel(conversationId: string): Promise<void>
    onEvent(cb: (event: ChatIpcEvent) => void): () => void
  }
  lessons: {
    list(): Promise<Lesson[]>
    extract(input: ExtractLessonInput): Promise<LessonExtraction>
    save(input: SaveLessonInput): Promise<Lesson>
    delete(id: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    patch(patch: SettingsPatch): Promise<AppSettings>
  }
  ai: {
    check(): Promise<AICheckResult>
  }
  image: {
    pick(): Promise<ImageInput[]>
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/shared/schemas.test.ts && npm run typecheck`
Expected: 全部 PASS；typecheck 无错误。

- [ ] **Step 7: 提交**

```bash
git add src/shared
git commit -m "feat: 共享 zod schema、类型与 IPC 接口定义

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 提示词文件与系统提示拼装

**Files:**
- Create: `src/main/prompts/base-tutor.md`、`free-chat.md`、`lesson-qa.md`、`role-play.md`、`scenario-task.md`、`extract-lesson.md`
- Create: `src/main/env.d.ts`、`src/main/learning/prompts.ts`
- Test: `src/main/learning/prompts.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PromptContext {
  mode: Mode
  difficulty: Difficulty
  chineseExplanations: boolean
  lesson?: { title: string; body: string; notesZh: string }
  scenario?: string
  profileSummary?: string   // 阶段 3 才会传
}
export function buildSystemPrompt(ctx: PromptContext): string
export const EXTRACT_LESSON_PROMPT: string
export const OPENING_INSTRUCTION: string
export const SCENARIOS: readonly string[]   // ['机场','出租车','餐厅','购物','看病挂号','工作会议']
```

- [ ] **Step 1: 写失败的测试 `src/main/learning/prompts.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, EXTRACT_LESSON_PROMPT, OPENING_INSTRUCTION, SCENARIOS } from './prompts'

const base = { difficulty: 'intermediate' as const, chineseExplanations: true }

describe('buildSystemPrompt', () => {
  it('always includes the base tutor rules and the difficulty', () => {
    const p = buildSystemPrompt({ ...base, mode: 'free' })
    expect(p).toContain('write your reply to the learner as plain text first')
    expect(p).toContain('Learner level: intermediate')
    expect(p).toContain('at most 3 new words')
  })
  it('includes lesson text only in lesson mode', () => {
    const lesson = { title: 'Lesson 5', body: 'Good morning, Mr. Blake.', notesZh: '介绍他人' }
    expect(buildSystemPrompt({ ...base, mode: 'lesson', lesson })).toContain('Good morning, Mr. Blake.')
    expect(buildSystemPrompt({ ...base, mode: 'free', lesson })).not.toContain('Good morning, Mr. Blake.')
  })
  it('throws when lesson mode has no lesson', () => {
    expect(() => buildSystemPrompt({ ...base, mode: 'lesson' })).toThrow(/lesson/)
  })
  it('includes the scenario in roleplay and scenario modes', () => {
    expect(buildSystemPrompt({ ...base, mode: 'roleplay', scenario: '餐厅' })).toContain('餐厅')
    expect(buildSystemPrompt({ ...base, mode: 'scenario', scenario: '机场' })).toContain('taskCompleted')
  })
  it('turns Chinese explanations off when asked', () => {
    expect(buildSystemPrompt({ ...base, mode: 'free', chineseExplanations: false })).toContain('explanationZh in simple English')
  })
  it('appends the learner profile when present', () => {
    expect(buildSystemPrompt({ ...base, mode: 'free', profileSummary: 'Level B1. Weak: articles.' })).toContain('Weak: articles.')
  })
  it('rejects targeted mode for now', () => {
    expect(() => buildSystemPrompt({ ...base, mode: 'targeted' })).toThrow(/targeted/)
  })
  it('exports constants', () => {
    expect(EXTRACT_LESSON_PROMPT).toContain('vocabulary')
    expect(OPENING_INSTRUCTION).toContain('Greet')
    expect(SCENARIOS).toContain('餐厅')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/learning/prompts.test.ts`
Expected: FAIL，找不到 `./prompts`。

- [ ] **Step 3: 写 `src/main/env.d.ts`**

```ts
declare module '*.md?raw' {
  const content: string
  export default content
}
```

- [ ] **Step 4: 写提示词文件**

`src/main/prompts/base-tutor.md`：

```md
You are SpeakMate, a patient English tutor for an adult Chinese learner practicing everyday and workplace English.

Rules for every turn:
- Reply in natural, simple English. Match the learner's level (given below): shorter sentences and common words for lower levels.
- Ask exactly one main question per turn so the conversation keeps going.
- Correct only the mistakes that matter most: errors that hurt meaning, or a clearly unnatural phrase. Skip tiny slips. Never turn the reply into a grammar lecture.
- If the learner's text looks like a speech-recognition error rather than a real language error (odd homophones, missing words), set correction.uncertain = true and ask what they meant.
- Suggest at most 3 new words per turn, each with a short Chinese meaning and one example sentence. Suggest none if nothing fits naturally.
- After a correction, encourage the learner to use the improved sentence or to keep answering.

Output format:
- First, write your reply to the learner as plain text first (this is streamed to the screen).
- Then fill the structured output: `reply` must be exactly that same text; `correction` (optional) with original / improved / explanationZh / category; `vocabulary` (optional, max 3); `nextAction` (optional, one short hint).
```

`src/main/prompts/free-chat.md`：

```md
Mode: free chat.
Talk about whatever the learner brings up: daily life, work, hobbies, news. Keep it light and curious. If the learner goes quiet, offer two concrete topics to choose from.
```

`src/main/prompts/lesson-qa.md`：

```md
Mode: lesson Q&A.
The learner is studying the lesson text below. Base your questions on it: check understanding of the dialogue, ask the learner to retell parts in their own words, point out useful phrases from the text, and invite them to use those phrases about their own life. Quote the lesson text when helpful. Do not introduce unrelated topics.
```

`src/main/prompts/role-play.md`：

```md
Mode: role play.
You play a native-speaker character in the scenario below (for example the waiter, the check-in agent, the doctor's receptionist, a colleague in a meeting). Stay in character and keep the scene moving with realistic lines. Corrections and vocabulary still go in the structured fields, never in your in-character lines. Start by setting the scene in one sentence.
```

`src/main/prompts/scenario-task.md`：

```md
Mode: scenario task.
The learner has a concrete goal to accomplish in the scenario below (for example: change a flight to tomorrow morning; order a meal without nuts and ask for the bill). You play the other person. Make it realistic but achievable in 6 to 10 turns. When the learner has clearly achieved the goal, say so warmly and set `taskCompleted` = true in the structured output; otherwise leave it false.
```

`src/main/prompts/extract-lesson.md`：

```md
You extract English learning material from images or pasted text for a Chinese learner.

Return:
- `title`: a short title (use the original lesson title if present, e.g. "Lesson 5: Nice to meet you").
- `body`: the full English text, faithfully transcribed, one line per sentence or dialogue line. Fix obvious OCR noise but do not rewrite.
- `vocabulary`: up to 15 words or phrases a learner at intermediate level may not know, each with a short Chinese meaning and an example sentence taken from or close to the text.
- `notesZh`: two to four sentences in Chinese explaining the key language points of this text.

If the image contains no English learning text, set `title` to "无法识别" and explain why in `notesZh`.
```

- [ ] **Step 5: 写 `src/main/learning/prompts.ts`**

```ts
import baseTutor from '../prompts/base-tutor.md?raw'
import freeChat from '../prompts/free-chat.md?raw'
import lessonQa from '../prompts/lesson-qa.md?raw'
import rolePlay from '../prompts/role-play.md?raw'
import scenarioTask from '../prompts/scenario-task.md?raw'
import extractLesson from '../prompts/extract-lesson.md?raw'
import type { Difficulty, Mode } from '@shared/types'

export const EXTRACT_LESSON_PROMPT: string = extractLesson

export const OPENING_INSTRUCTION =
  '(The session starts now. Greet the learner in one or two sentences and ask your first question. No correction this turn.)'

export const SCENARIOS = ['机场', '出租车', '餐厅', '购物', '看病挂号', '工作会议'] as const

export interface PromptContext {
  mode: Mode
  difficulty: Difficulty
  chineseExplanations: boolean
  lesson?: { title: string; body: string; notesZh: string }
  scenario?: string
  profileSummary?: string
}

const MODE_PROMPT: Record<Exclude<Mode, 'targeted'>, string> = {
  free: freeChat,
  lesson: lessonQa,
  roleplay: rolePlay,
  scenario: scenarioTask
}

const LEVEL_HINT: Record<Difficulty, string> = {
  beginner: 'beginner (A2): very short sentences, common words only, one idea per sentence',
  intermediate: 'intermediate (B1): everyday sentences, occasional new word',
  advanced: 'advanced (B2+): natural pace, idioms allowed'
}

export function buildSystemPrompt(ctx: PromptContext): string {
  if (ctx.mode === 'targeted') throw new Error('targeted mode is not available yet')
  if (ctx.mode === 'lesson' && !ctx.lesson) throw new Error('lesson mode requires a lesson')
  if ((ctx.mode === 'roleplay' || ctx.mode === 'scenario') && !ctx.scenario) {
    throw new Error(`${ctx.mode} mode requires a scenario`)
  }

  const parts: string[] = [baseTutor.trim()]
  parts.push(`Learner level: ${ctx.difficulty}. Guidance: ${LEVEL_HINT[ctx.difficulty]}.`)
  parts.push(
    ctx.chineseExplanations
      ? 'Write explanationZh and meaningZh in simple Chinese.'
      : 'The learner turned Chinese off: write explanationZh in simple English and meaningZh in simple English.'
  )
  if (ctx.profileSummary) parts.push(`Learner profile:\n${ctx.profileSummary}`)
  parts.push(MODE_PROMPT[ctx.mode].trim())
  if (ctx.mode === 'lesson' && ctx.lesson) {
    parts.push(`Lesson title: ${ctx.lesson.title}\nLesson text:\n${ctx.lesson.body}\nNotes (Chinese): ${ctx.lesson.notesZh}`)
  }
  if (ctx.scenario) parts.push(`Scenario: ${ctx.scenario}`)
  return parts.join('\n\n')
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/main/learning/prompts.test.ts && npm run typecheck`
Expected: PASS。若 typecheck 报 `?raw` 模块找不到，确认 `tsconfig.node.json` 的 include 覆盖了 `src/main/**/*`（含 `env.d.ts`）。

- [ ] **Step 7: 提交**

```bash
git add src/main/prompts src/main/learning src/main/env.d.ts
git commit -m "feat: 教学提示词文件与系统提示拼装

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: AIProvider 接口与 Fake 实现

**Files:**
- Create: `src/main/ai/types.ts`、`src/main/ai/fake.ts`
- Test: `src/main/ai/fake.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export interface ChatRequest { conversationId: string; firstTurn: boolean; systemPrompt?: string; text: string; signal: AbortSignal; model?: string }
export interface AnalyzeRequest<T> { systemPrompt: string; text: string; images?: ImageInput[]; schema: ZodType<T>; signal?: AbortSignal; model?: string }
export interface AIProvider {
  chat(req: ChatRequest): AsyncIterable<ChatEvent>
  analyze<T>(req: AnalyzeRequest<T>): Promise<T>
  deleteSession(conversationId: string): Promise<void>
  check(): Promise<AICheckResult>
}
export class AIError extends Error { kind: AIErrorKind }
// fake.ts
export class FakeAIProvider implements AIProvider {
  constructor(opts?: { reply?: TutorResponse; analyzeResult?: unknown; failWith?: AIErrorKind; deltaDelayMs?: number })
  calls: ChatRequest[]; analyzeCalls: AnalyzeRequest<unknown>[]; deleted: string[]
}
```

- [ ] **Step 1: 写失败的测试 `src/main/ai/fake.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { FakeAIProvider } from './fake'
import { LessonExtractionSchema } from '@shared/schemas'
import type { ChatEvent } from '@shared/types'

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('FakeAIProvider', () => {
  it('streams the reply word by word then emits done with structured output', async () => {
    const fake = new FakeAIProvider({ reply: { reply: 'Hello there friend' } })
    const events = await collect(fake.chat({ conversationId: 'c1', firstTurn: true, systemPrompt: 's', text: 'hi', signal: new AbortController().signal }))
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e.type === 'text_delta' ? e.text : '')).join('')
    expect(text).toBe('Hello there friend')
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type === 'done') expect(done.structured?.reply).toBe('Hello there friend')
    expect(fake.calls[0]?.text).toBe('hi')
  })
  it('emits error when configured to fail', async () => {
    const fake = new FakeAIProvider({ failWith: 'not_logged_in' })
    const events = await collect(fake.chat({ conversationId: 'c1', firstTurn: true, text: 'hi', signal: new AbortController().signal }))
    expect(events).toEqual([{ type: 'error', kind: 'not_logged_in', message: expect.any(String) }])
  })
  it('stops with aborted when the signal fires', async () => {
    const fake = new FakeAIProvider({ reply: { reply: 'one two three four five' }, deltaDelayMs: 5 })
    const ac = new AbortController()
    const events: ChatEvent[] = []
    for await (const e of fake.chat({ conversationId: 'c1', firstTurn: true, text: 'hi', signal: ac.signal })) {
      events.push(e)
      if (events.length === 2) ac.abort()
    }
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'aborted', message: expect.any(String) })
  })
  it('analyze returns the configured object after validating it against the schema', async () => {
    const fake = new FakeAIProvider({ analyzeResult: { title: 'L5', body: 'Hi.', vocabulary: [], notesZh: '' } })
    const r = await fake.analyze({ systemPrompt: 's', text: 't', schema: LessonExtractionSchema })
    expect(r.title).toBe('L5')
    expect(fake.analyzeCalls).toHaveLength(1)
  })
  it('records deleted sessions and answers check', async () => {
    const fake = new FakeAIProvider()
    await fake.deleteSession('c1')
    expect(fake.deleted).toEqual(['c1'])
    expect((await fake.check()).ok).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/ai/fake.test.ts`
Expected: FAIL，找不到 `./fake`。

- [ ] **Step 3: 写 `src/main/ai/types.ts`**

```ts
import type { ZodType } from 'zod'
import type { AICheckResult, AIErrorKind, ChatEvent, ImageInput } from '@shared/types'

export interface ChatRequest {
  conversationId: string
  firstTurn: boolean
  systemPrompt?: string
  text: string
  signal: AbortSignal
  model?: string
}

export interface AnalyzeRequest<T> {
  systemPrompt: string
  text: string
  images?: ImageInput[]
  schema: ZodType<T>
  signal?: AbortSignal
  model?: string
}

export interface AIProvider {
  chat(req: ChatRequest): AsyncIterable<ChatEvent>
  analyze<T>(req: AnalyzeRequest<T>): Promise<T>
  deleteSession(conversationId: string): Promise<void>
  check(): Promise<AICheckResult>
}

export class AIError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'AIError'
  }
}
```

- [ ] **Step 4: 写 `src/main/ai/fake.ts`**

```ts
import type { AICheckResult, AIErrorKind, ChatEvent, TutorResponse } from '@shared/types'
import { AIError, type AIProvider, type AnalyzeRequest, type ChatRequest } from './types'

export interface FakeAIOptions {
  reply?: TutorResponse
  analyzeResult?: unknown
  failWith?: AIErrorKind
  deltaDelayMs?: number
}

const DEFAULT_REPLY: TutorResponse = {
  reply: 'Nice to meet you! What did you do today?',
  correction: {
    original: 'I goed to work',
    improved: 'I went to work',
    explanationZh: 'go 的过去式是 went。',
    category: 'grammar'
  },
  vocabulary: [{ word: 'commute', meaningZh: '通勤', example: 'My commute takes 40 minutes.' }]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class FakeAIProvider implements AIProvider {
  calls: ChatRequest[] = []
  analyzeCalls: AnalyzeRequest<unknown>[] = []
  deleted: string[] = []

  constructor(private readonly opts: FakeAIOptions = {}) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    this.calls.push(req)
    if (this.opts.failWith) {
      yield { type: 'error', kind: this.opts.failWith, message: `fake failure: ${this.opts.failWith}` }
      return
    }
    const reply = this.opts.reply ?? DEFAULT_REPLY
    const words = reply.reply.split(' ')
    for (let i = 0; i < words.length; i++) {
      if (this.opts.deltaDelayMs) await sleep(this.opts.deltaDelayMs)
      if (req.signal.aborted) {
        yield { type: 'error', kind: 'aborted', message: 'aborted' }
        return
      }
      yield { type: 'text_delta', text: (i === 0 ? '' : ' ') + words[i] }
    }
    yield { type: 'done', structured: reply, rawText: reply.reply }
  }

  async analyze<T>(req: AnalyzeRequest<T>): Promise<T> {
    this.analyzeCalls.push(req as AnalyzeRequest<unknown>)
    if (this.opts.failWith) throw new AIError(this.opts.failWith, `fake failure: ${this.opts.failWith}`)
    const parsed = req.schema.safeParse(this.opts.analyzeResult)
    if (!parsed.success) throw new AIError('unknown', 'fake analyzeResult does not match schema')
    return parsed.data
  }

  async deleteSession(conversationId: string): Promise<void> {
    this.deleted.push(conversationId)
  }

  async check(): Promise<AICheckResult> {
    return { ok: true, model: 'fake', durationMs: 1, message: 'FakeAIProvider' }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/main/ai/fake.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/ai
git commit -m "feat: AIProvider 接口与 Fake 实现

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: ClaudeCliProvider（Agent SDK）

**Files:**
- Create: `src/main/ai/env.ts`、`src/main/ai/json-schema.ts`、`src/main/ai/claude-cli.ts`
- Test: `src/main/ai/env.test.ts`、`src/main/ai/claude-cli.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `AIProvider`、`ChatRequest`、`AnalyzeRequest`、`AIError`；Task 2 的 `TutorResponseSchema`。
- Produces:

```ts
export function cleanEnv(src: NodeJS.ProcessEnv): Record<string, string>
export function toJsonSchema(schema: ZodType): Record<string, unknown>
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => AsyncIterable<SDKMessage>
export interface ClaudeCliProviderOptions { sessionsDir: string; queryFn?: QueryFn; deleteSessionFn?: (id: string, o: { dir: string }) => Promise<void>; env?: NodeJS.ProcessEnv }
export class ClaudeCliProvider implements AIProvider
```

- [ ] **Step 1: 写失败的测试 `src/main/ai/env.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { cleanEnv } from './env'

describe('cleanEnv', () => {
  it('removes API key variables that would override the subscription login', () => {
    const out = cleanEnv({ HOME: '/Users/x', ANTHROPIC_API_KEY: 'sk', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', PATH: '/usr/bin' })
    expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(out.HOME).toBe('/Users/x')
  })
  it('adds homebrew and local bin to a minimal Finder PATH', () => {
    const out = cleanEnv({ PATH: '/usr/bin:/bin' })
    expect(out.PATH.split(':')).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])
  })
  it('does not duplicate PATH entries and tolerates missing PATH', () => {
    expect(cleanEnv({ PATH: '/opt/homebrew/bin:/usr/bin' }).PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin')
    expect(cleanEnv({}).PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
  })
  it('drops undefined values', () => {
    expect('X' in cleanEnv({ X: undefined })).toBe(false)
  })
})
```

- [ ] **Step 2: 写失败的测试 `src/main/ai/claude-cli.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCliProvider, type QueryFn } from './claude-cli'
import { LessonExtractionSchema } from '@shared/schemas'
import type { ChatEvent } from '@shared/types'

type Captured = { prompt: SDKUserMessage[]; options: Options | undefined }

function fakeQuery(script: (captured: Captured) => SDKMessage[] | Promise<SDKMessage[]>): { fn: QueryFn; captured: Captured } {
  const captured: Captured = { prompt: [], options: undefined }
  const fn: QueryFn = ({ prompt, options }) => {
    captured.options = options
    return (async function* () {
      for await (const m of prompt) captured.prompt.push(m)
      for (const m of await script(captured)) yield m
    })()
  }
  return { fn, captured }
}

const delta = (text: string): SDKMessage =>
  ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: null, uuid: 'u', session_id: 's' }) as unknown as SDKMessage
const init = (model = 'claude-x'): SDKMessage => ({ type: 'system', subtype: 'init', model, session_id: 's', apiKeySource: 'none' }) as unknown as SDKMessage
const success = (structured: unknown, result = ''): SDKMessage =>
  ({ type: 'result', subtype: 'success', structured_output: structured, result, is_error: false, num_turns: 2, session_id: 's', usage: {} }) as unknown as SDKMessage
const failure = (subtype: string, errors: string[]): SDKMessage => ({ type: 'result', subtype, errors, is_error: true, session_id: 's' }) as unknown as SDKMessage
const retry = (attempt: number): SDKMessage => ({ type: 'system', subtype: 'api_retry', attempt, max_retries: 3, session_id: 's' }) as unknown as SDKMessage

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const sig = (): AbortSignal => new AbortController().signal

describe('ClaudeCliProvider.chat', () => {
  it('first turn passes sessionId + systemPrompt and the mandatory options', async () => {
    const { fn, captured } = fakeQuery(() => [init(), delta('Hi'), success({ reply: 'Hi' })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn, env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'x' } })
    const events = await collect(p.chat({ conversationId: 'conv-1', firstTurn: true, systemPrompt: 'SYS', text: 'hello', signal: sig(), model: 'sonnet' }))
    const o = captured.options!
    expect(o.sessionId).toBe('conv-1')
    expect(o.resume).toBeUndefined()
    expect(o.systemPrompt).toBe('SYS')
    expect(o.settingSources).toEqual([])
    expect(o.tools).toEqual([])
    expect(o.disallowedTools).toBeUndefined()
    expect(o.permissionMode).toBe('dontAsk')
    expect(o.cwd).toBe('/tmp/s')
    expect(o.includePartialMessages).toBe(true)
    expect(o.model).toBe('sonnet')
    expect(o.outputFormat).toMatchObject({ type: 'json_schema' })
    expect((o.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined()
    expect(captured.prompt[0]?.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(events).toEqual([{ type: 'text_delta', text: 'Hi' }, { type: 'done', structured: { reply: 'Hi' }, rawText: 'Hi' }])
  })
  it('later turns resume and send no system prompt', async () => {
    const { fn, captured } = fakeQuery(() => [init(), success({ reply: 'ok' })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    await collect(p.chat({ conversationId: 'conv-1', firstTurn: false, text: 'x', signal: sig() }))
    expect(captured.options!.resume).toBe('conv-1')
    expect(captured.options!.sessionId).toBeUndefined()
    expect(captured.options!.systemPrompt).toBeUndefined()
  })
  it('degrades to plain text when structured output is missing or invalid', async () => {
    const { fn } = fakeQuery(() => [init(), delta('Plain '), delta('text'), success({ nope: 1 })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() }))
    expect(events.at(-1)).toEqual({ type: 'done', structured: undefined, rawText: 'Plain text' })
  })
  it('uses result text as rawText when nothing streamed', async () => {
    const { fn } = fakeQuery(() => [init(), success(undefined, 'from result')])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() }))
    expect(events.at(-1)).toEqual({ type: 'done', structured: undefined, rawText: 'from result' })
  })
  it('maps api_retry to retrying and error results to error kinds', async () => {
    const { fn } = fakeQuery(() => [init(), retry(1), failure('error_during_execution', ['Not logged in. Please run /login'])])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(p.chat({ conversationId: 'c', firstTurn: true, systemPrompt: 's', text: 'x', signal: sig() }))
    expect(events[0]).toEqual({ type: 'retrying', attempt: 1 })
    expect(events[1]).toMatchObject({ type: 'error', kind: 'not_logged_in' })
  })
  it('reports aborted when the signal fires mid-stream', async () => {
    const ac = new AbortController()
    const { fn } = fakeQuery(async () => {
      ac.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: ac.signal }))
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'aborted' })
  })
  it('reports binary_missing when the SDK throws about the native CLI', async () => {
    const { fn } = fakeQuery(async () => {
      throw new Error('Native CLI binary for darwin-arm64 not found')
    })
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const events = await collect(p.chat({ conversationId: 'c', firstTurn: false, text: 'x', signal: sig() }))
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'binary_missing' })
  })
})

describe('ClaudeCliProvider.analyze', () => {
  it('sends images as base64 blocks, does not persist, and returns the parsed object', async () => {
    const lesson = { title: 'L5', body: 'Good morning.', vocabulary: [], notesZh: '' }
    const { fn, captured } = fakeQuery(() => [init(), success(lesson)])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.analyze({ systemPrompt: 'EXTRACT', text: 'see image', images: [{ mime: 'image/png', base64: 'QUJD' }], schema: LessonExtractionSchema })
    expect(r).toEqual(lesson)
    expect(captured.options!.persistSession).toBe(false)
    expect(captured.options!.systemPrompt).toBe('EXTRACT')
    expect(captured.prompt[0]?.message.content).toEqual([
      { type: 'text', text: 'see image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
    ])
  })
  it('throws AIError when the structured output is missing', async () => {
    const { fn } = fakeQuery(() => [init(), success(undefined, 'oops')])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    await expect(p.analyze({ systemPrompt: 's', text: 't', schema: LessonExtractionSchema })).rejects.toMatchObject({ name: 'AIError', kind: 'unknown' })
  })
})

describe('ClaudeCliProvider.check / deleteSession', () => {
  it('check reports the model from the init message', async () => {
    const { fn } = fakeQuery(() => [init('claude-opus-5'), success({ ok: true })])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.check()
    expect(r.ok).toBe(true)
    expect(r.model).toBe('claude-opus-5')
  })
  it('check reports failure without throwing', async () => {
    const { fn } = fakeQuery(() => [failure('error_during_execution', ['authentication failed'])])
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fn })
    const r = await p.check()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/authentication/)
  })
  it('deleteSession delegates with the sessions dir and swallows errors', async () => {
    const calls: unknown[] = []
    const p = new ClaudeCliProvider({ sessionsDir: '/tmp/s', queryFn: fakeQuery(() => []).fn, deleteSessionFn: async (id, o) => { calls.push([id, o]); throw new Error('nope') } })
    await expect(p.deleteSession('c9')).resolves.toBeUndefined()
    expect(calls).toEqual([['c9', { dir: '/tmp/s' }]])
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/ai`
Expected: `env.test.ts` 与 `claude-cli.test.ts` FAIL（模块不存在）。

- [ ] **Step 4: 写 `src/main/ai/env.ts`**

```ts
const SECRET_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']
const FALLBACK_PATH = ['/usr/bin', '/bin']

export function cleanEnv(src: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || SECRET_VARS.includes(k)) continue
    out[k] = v
  }
  const existing = (src.PATH ?? FALLBACK_PATH.join(':')).split(':').filter(Boolean)
  const merged = [...EXTRA_PATH, ...existing].filter((p, i, arr) => arr.indexOf(p) === i)
  out.PATH = merged.join(':')
  return out
}
```

- [ ] **Step 5: 写 `src/main/ai/json-schema.ts`**

```ts
import { z, type ZodType } from 'zod'

export function toJsonSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete js.$schema
  return js
}
```

- [ ] **Step 6: 写 `src/main/ai/claude-cli.ts`**

```ts
import { query, deleteSession, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodType } from 'zod'
import { TutorResponseSchema } from '@shared/schemas'
import type { AICheckResult, AIErrorKind, ChatEvent, ImageInput } from '@shared/types'
import { AIError, type AIProvider, type AnalyzeRequest, type ChatRequest } from './types'
import { cleanEnv } from './env'
import { toJsonSchema } from './json-schema'

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => AsyncIterable<SDKMessage>

export interface ClaudeCliProviderOptions {
  sessionsDir: string
  queryFn?: QueryFn
  deleteSessionFn?: (id: string, o: { dir: string }) => Promise<void>
  env?: NodeJS.ProcessEnv
}

const TUTOR_JSON_SCHEMA = toJsonSchema(TutorResponseSchema)
const CheckSchema = z.object({ ok: z.boolean() })

async function* userMessage(text: string, images: ImageInput[] = []): AsyncIterable<SDKUserMessage> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })
  }
  yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content } } as SDKUserMessage
}

export function classifyError(message: string): AIErrorKind {
  const m = message.toLowerCase()
  if (m.includes('native cli binary') || m.includes('enoent')) return 'binary_missing'
  if (m.includes('not logged in') || m.includes('/login') || m.includes('authentication') || m.includes('unauthorized')) return 'not_logged_in'
  if (m.includes('rate limit') || m.includes('429') || m.includes('overloaded')) return 'rate_limited'
  if (m.includes('network') || m.includes('econn') || m.includes('fetch failed') || m.includes('timeout')) return 'network'
  return 'unknown'
}

export class ClaudeCliProvider implements AIProvider {
  private readonly queryFn: QueryFn
  private readonly deleteSessionFn: (id: string, o: { dir: string }) => Promise<void>

  constructor(private readonly opts: ClaudeCliProviderOptions) {
    this.queryFn = opts.queryFn ?? (query as unknown as QueryFn)
    this.deleteSessionFn = opts.deleteSessionFn ?? deleteSession
  }

  private baseOptions(signal: AbortSignal | undefined, model: string | undefined): Options {
    const abortController = new AbortController()
    if (signal) {
      if (signal.aborted) abortController.abort()
      else signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }
    return {
      settingSources: [],
      tools: [],
      permissionMode: 'dontAsk',
      cwd: this.opts.sessionsDir,
      env: cleanEnv(this.opts.env ?? process.env),
      abortController,
      maxTurns: 3,
      ...(model ? { model } : {})
    }
  }

  private async *run(
    prompt: AsyncIterable<SDKUserMessage>,
    options: Options,
    schema: ZodType,
    onInit?: (model: string) => void
  ): AsyncIterable<ChatEvent> {
    let text = ''
    try {
      for await (const m of this.queryFn({ prompt, options })) {
        if (m.type === 'stream_event') {
          const ev = m.event as { type: string; delta?: { type: string; text?: string } }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text
            yield { type: 'text_delta', text: ev.delta.text }
          }
        } else if (m.type === 'system') {
          const sys = m as unknown as { subtype: string; attempt?: number; model?: string }
          if (sys.subtype === 'init' && sys.model) onInit?.(sys.model)
          else if (sys.subtype === 'api_retry') yield { type: 'retrying', attempt: sys.attempt ?? 1 }
        } else if (m.type === 'result') {
          if (m.subtype === 'success') {
            const parsed = schema.safeParse(m.structured_output)
            const rawText = text || (typeof m.result === 'string' ? m.result : '')
            yield { type: 'done', structured: parsed.success ? parsed.data : undefined, rawText }
          } else {
            const errs = (m as unknown as { errors?: string[] }).errors
            const message = errs?.length ? errs.join('; ') : m.subtype
            yield { type: 'error', kind: classifyError(message), message }
          }
        }
      }
    } catch (e) {
      const err = e as Error
      const kind: AIErrorKind = err?.name === 'AbortError' || options.abortController?.signal.aborted ? 'aborted' : classifyError(String(err?.message ?? e))
      yield { type: 'error', kind, message: String(err?.message ?? e) }
    }
  }

  chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const options: Options = {
      ...this.baseOptions(req.signal, req.model),
      includePartialMessages: true,
      outputFormat: { type: 'json_schema', schema: TUTOR_JSON_SCHEMA },
      ...(req.firstTurn ? { sessionId: req.conversationId, systemPrompt: req.systemPrompt } : { resume: req.conversationId })
    }
    return this.run(userMessage(req.text), options, TutorResponseSchema)
  }

  async analyze<T>(req: AnalyzeRequest<T>): Promise<T> {
    const options: Options = {
      ...this.baseOptions(req.signal, req.model),
      systemPrompt: req.systemPrompt,
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: toJsonSchema(req.schema) }
    }
    for await (const ev of this.run(userMessage(req.text, req.images), options, req.schema)) {
      if (ev.type === 'done') {
        if (ev.structured === undefined) throw new AIError('unknown', '模型没有返回结构化结果')
        return ev.structured as T
      }
      if (ev.type === 'error') throw new AIError(ev.kind, ev.message)
    }
    throw new AIError('unknown', '调用结束但没有结果')
  }

  async deleteSession(conversationId: string): Promise<void> {
    try {
      await this.deleteSessionFn(conversationId, { dir: this.opts.sessionsDir })
    } catch {
      // best-effort
    }
  }

  async check(): Promise<AICheckResult> {
    const started = Date.now()
    let model: string | undefined
    const options: Options = {
      ...this.baseOptions(undefined, undefined),
      systemPrompt: 'Reply with ok=true.',
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: toJsonSchema(CheckSchema) }
    }
    for await (const ev of this.run(userMessage('ping'), options, CheckSchema, (m) => (model = m))) {
      if (ev.type === 'done') return { ok: true, model, durationMs: Date.now() - started, message: '连接正常' }
      if (ev.type === 'error') return { ok: false, model, durationMs: Date.now() - started, message: ev.message }
    }
    return { ok: false, message: '没有收到结果' }
  }
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/main/ai && npm run typecheck`
Expected: 全部 PASS。若 `SDKUserMessage` 类型断言报错，改成 `as unknown as SDKUserMessage`。

- [ ] **Step 8: 提交**

```bash
git add src/main/ai
git commit -m "feat: ClaudeCliProvider（Agent SDK 驱动本机 Claude Code）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 数据库：打开、迁移与四张表的读写

**Files:**
- Create: `src/main/db/index.ts`、`src/main/db/migrations.ts`、`src/main/db/conversations.ts`、`src/main/db/messages.ts`、`src/main/db/lessons.ts`、`src/main/db/settings.ts`
- Test: `src/main/db/db.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Conversation`、`Message`、`Lesson`、`AppSettings`、`DEFAULT_SETTINGS`。
- Produces:

```ts
export type Db = DatabaseSync                              // db/index.ts
export function openDatabase(file: string): Db             // ':memory:' 也可
export function migrate(db: Db): number                    // 返回迁移后的 user_version
export function insertConversation(db: Db, c: Conversation): void
export function listConversations(db: Db): Conversation[]  // updated_at 倒序
export function getConversation(db: Db, id: string): Conversation | undefined
export function deleteConversation(db: Db, id: string): void
export function markSessionStarted(db: Db, id: string): void
export function bumpTurn(db: Db, id: string, now: string): void
export function insertMessage(db: Db, m: Message): void
export function updateMessage(db: Db, id: string, patch: { content: string; structured: TutorResponse | null; status: MessageStatus }): void
export function listMessages(db: Db, conversationId: string): Message[]   // created_at 升序
export function insertLesson(db: Db, lesson: Lesson): void
export function listLessons(db: Db): Lesson[]              // created_at 倒序，含 assets
export function getLesson(db: Db, id: string): Lesson | undefined
export function deleteLesson(db: Db, id: string): void
export function getSettings(db: Db): AppSettings
export function patchSettings(db: Db, patch: Partial<AppSettings>): AppSettings
```

- [ ] **Step 1: 写失败的测试 `src/main/db/db.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, migrate, type Db } from './index'
import { insertConversation, listConversations, getConversation, deleteConversation, markSessionStarted, bumpTurn } from './conversations'
import { insertMessage, updateMessage, listMessages } from './messages'
import { insertLesson, listLessons, getLesson, deleteLesson } from './lessons'
import { getSettings, patchSettings } from './settings'
import type { Conversation, Lesson, Message } from '@shared/types'

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, title: '自由聊天', mode: 'free', lessonId: null, scenario: null, turnCount: 0, sessionStarted: false,
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', endedAt: null, ...over
})
const msg = (id: string, conversationId: string, over: Partial<Message> = {}): Message => ({
  id, conversationId, role: 'user', content: 'hi', structured: null, status: 'done', fromAsr: false, createdAt: `2026-10-12T00:00:0${id.length % 10}.000Z`, ...over
})

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('migrate', () => {
  it('sets user_version and is idempotent', () => {
    expect(migrate(db)).toBe(1)
    expect(migrate(db)).toBe(1)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['conversations', 'lesson_assets', 'lessons', 'messages', 'settings'])
  })
})

describe('conversations', () => {
  it('round-trips, orders by updated_at desc, bumps turns and marks session', () => {
    insertConversation(db, conv('a'))
    insertConversation(db, conv('b', { updatedAt: '2026-10-13T00:00:00.000Z', mode: 'lesson', lessonId: null, scenario: '餐厅' }))
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
    expect(list[1]).toMatchObject({ content: 'Hello!', status: 'done', structured: { reply: 'Hello!' } })
  })
})

describe('lessons', () => {
  const lesson: Lesson = {
    id: 'l1', title: 'Lesson 5', body: 'Good morning.', source: 'image', notesZh: '问候', createdAt: '2026-10-12T00:00:00.000Z',
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
    expect(s).toMatchObject({ difficulty: 'beginner', autoSpeak: false, rate: 160, voice: 'Samantha' })
    expect(getSettings(db).autoSpeak).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/db`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/db/migrations.ts`**

```ts
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
`
]
```

- [ ] **Step 4: 写 `src/main/db/index.ts`**

```ts
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Db = DatabaseSync

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return version
}
```

- [ ] **Step 5: 写 `src/main/db/conversations.ts`**

```ts
import type { Conversation, Mode } from '@shared/types'
import type { Db } from './index'

interface Row {
  id: string; title: string; mode: string; lesson_id: string | null; scenario: string | null
  turn_count: number; session_started: number; created_at: string; updated_at: string; ended_at: string | null
}

const toConversation = (r: Row): Conversation => ({
  id: r.id, title: r.title, mode: r.mode as Mode, lessonId: r.lesson_id, scenario: r.scenario,
  turnCount: r.turn_count, sessionStarted: r.session_started === 1,
  createdAt: r.created_at, updatedAt: r.updated_at, endedAt: r.ended_at
})

export function insertConversation(db: Db, c: Conversation): void {
  db.prepare(
    `INSERT INTO conversations (id, title, mode, lesson_id, scenario, turn_count, session_started, created_at, updated_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(c.id, c.title, c.mode, c.lessonId, c.scenario, c.turnCount, c.sessionStarted ? 1 : 0, c.createdAt, c.updatedAt, c.endedAt)
}

export function listConversations(db: Db): Conversation[] {
  return (db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as unknown as Row[]).map(toConversation)
}

export function getConversation(db: Db, id: string): Conversation | undefined {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as Row | undefined
  return row ? toConversation(row) : undefined
}

export function deleteConversation(db: Db, id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function markSessionStarted(db: Db, id: string): void {
  db.prepare('UPDATE conversations SET session_started = 1 WHERE id = ?').run(id)
}

export function bumpTurn(db: Db, id: string, now: string): void {
  db.prepare('UPDATE conversations SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?').run(now, id)
}
```

- [ ] **Step 6: 写 `src/main/db/messages.ts`**

```ts
import type { Message, MessageStatus, TutorResponse } from '@shared/types'
import type { Db } from './index'

interface Row {
  id: string; conversation_id: string; role: string; content: string
  structured_json: string | null; status: string; from_asr: number; created_at: string
}

const toMessage = (r: Row): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role as Message['role'], content: r.content,
  structured: r.structured_json ? (JSON.parse(r.structured_json) as TutorResponse) : null,
  status: r.status as MessageStatus, fromAsr: r.from_asr === 1, createdAt: r.created_at
})

export function insertMessage(db: Db, m: Message): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, structured_json, status, from_asr, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.id, m.conversationId, m.role, m.content, m.structured ? JSON.stringify(m.structured) : null, m.status, m.fromAsr ? 1 : 0, m.createdAt)
}

export function updateMessage(db: Db, id: string, patch: { content: string; structured: TutorResponse | null; status: MessageStatus }): void {
  db.prepare('UPDATE messages SET content = ?, structured_json = ?, status = ? WHERE id = ?').run(
    patch.content, patch.structured ? JSON.stringify(patch.structured) : null, patch.status, id
  )
}

export function listMessages(db: Db, conversationId: string): Message[] {
  return (db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC').all(conversationId) as unknown as Row[]).map(toMessage)
}
```

- [ ] **Step 7: 写 `src/main/db/lessons.ts`**

```ts
import type { Lesson, LessonAsset } from '@shared/types'
import type { Db } from './index'

interface LessonRow { id: string; title: string; body: string; source: string; notes_zh: string; vocab_json: string; created_at: string }
interface AssetRow { id: string; lesson_id: string; path: string; mime: string; size: number }

function assetsFor(db: Db, lessonId: string): LessonAsset[] {
  return (db.prepare('SELECT * FROM lesson_assets WHERE lesson_id = ? ORDER BY rowid').all(lessonId) as unknown as AssetRow[]).map((a) => ({
    id: a.id, lessonId: a.lesson_id, path: a.path, mime: a.mime, size: a.size
  }))
}

const toLesson = (db: Db, r: LessonRow): Lesson => ({
  id: r.id, title: r.title, body: r.body, source: r.source as Lesson['source'], notesZh: r.notes_zh,
  vocabulary: JSON.parse(r.vocab_json), createdAt: r.created_at, assets: assetsFor(db, r.id)
})

export function insertLesson(db: Db, lesson: Lesson): void {
  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO lessons (id, title, body, source, notes_zh, vocab_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      lesson.id, lesson.title, lesson.body, lesson.source, lesson.notesZh, JSON.stringify(lesson.vocabulary), lesson.createdAt
    )
    const ins = db.prepare('INSERT INTO lesson_assets (id, lesson_id, path, mime, size) VALUES (?, ?, ?, ?, ?)')
    for (const a of lesson.assets) ins.run(a.id, lesson.id, a.path, a.mime, a.size)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function listLessons(db: Db): Lesson[] {
  return (db.prepare('SELECT * FROM lessons ORDER BY created_at DESC').all() as unknown as LessonRow[]).map((r) => toLesson(db, r))
}

export function getLesson(db: Db, id: string): Lesson | undefined {
  const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as unknown as LessonRow | undefined
  return row ? toLesson(db, row) : undefined
}

export function deleteLesson(db: Db, id: string): void {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
}
```

- [ ] **Step 8: 写 `src/main/db/settings.ts`**

```ts
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import type { Db } from './index'

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[]
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value)
  }
  return out as unknown as AppSettings
}

export function patchSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !(k in DEFAULT_SETTINGS)) continue
    up.run(k, JSON.stringify(v))
  }
  return getSettings(db)
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run src/main/db && npm run typecheck`
Expected: PASS。Node 会打印一行 `ExperimentalWarning: SQLite`，无妨。若 typecheck 报 `node:sqlite` 没有类型，升级 `@types/node` 到 22.19 以上。

- [ ] **Step 10: 提交**

```bash
git add src/main/db
git commit -m "feat: node:sqlite 数据层与首个迁移

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: ChatService

**Files:**
- Create: `src/main/chat/service.ts`
- Modify: `src/main/ai/fake.ts`（加 `omitStructured` 选项）
- Test: `src/main/chat/service.test.ts`

**Interfaces:**
- Consumes: Task 4 `AIProvider`；Task 6 的全部 db 函数；Task 3 `buildSystemPrompt`、`OPENING_INSTRUCTION`；Task 2 类型。
- Produces:

```ts
export interface ChatServiceDeps {
  db: Db
  ai: AIProvider
  send: (event: ChatIpcEvent) => void
  now?: () => string          // 默认 new Date().toISOString()
  uuid?: () => string         // 默认 crypto.randomUUID
}
export class ChatService {
  constructor(deps: ChatServiceDeps)
  createConversation(input: CreateConversationInput): Promise<{ conversation: Conversation; assistantMessageId: string }>
  send(input: SendMessageInput): Promise<{ userMessage: Message; assistantMessageId: string }>
  cancel(conversationId: string): void
  deleteConversation(conversationId: string): Promise<void>
  whenIdle(conversationId: string): Promise<void>     // 测试和退出时等待进行中的一轮
  cancelAll(): void
}
```

- [ ] **Step 1: 给 FakeAIProvider 加 `omitStructured`**

`src/main/ai/fake.ts` 的 `FakeAIOptions` 加 `omitStructured?: boolean`，`chat()` 最后一行改为：

```ts
    yield { type: 'done', structured: this.opts.omitStructured ? undefined : reply, rawText: reply.reply }
```

- [ ] **Step 2: 写失败的测试 `src/main/chat/service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/index'
import { insertLesson } from '../db/lessons'
import { getConversation, listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from './service'
import type { ChatIpcEvent } from '@shared/types'

let db: Db
let events: ChatIpcEvent[]
let n: number
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
const mk = (ai: FakeAIProvider): ChatService =>
  new ChatService({ db, ai, send: (e) => events.push(e), uuid: () => ids[n++], now: () => `2026-10-12T00:00:0${n}.000Z` })

beforeEach(() => {
  db = openDatabase(':memory:')
  events = []
  n = 0
})

describe('createConversation', () => {
  it('inserts the conversation, runs the opening turn as first turn without a user message', async () => {
    const ai = new FakeAIProvider({ reply: { reply: 'Hi! What did you do today?' } })
    const svc = mk(ai)
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('自由聊天')
    expect(ai.calls[0]).toMatchObject({ conversationId: conversation.id, firstTurn: true })
    expect(ai.calls[0].systemPrompt).toContain('Mode: free chat')
    expect(ai.calls[0].text).toContain('Greet')
    const msgs = listMessages(db, conversation.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ id: assistantMessageId, role: 'assistant', status: 'done', content: 'Hi! What did you do today?' })
    expect(msgs[0].structured?.reply).toBe('Hi! What did you do today?')
    expect(getConversation(db, conversation.id)?.sessionStarted).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done', conversationId: conversation.id, messageId: assistantMessageId })
    expect(events.filter((e) => e.type === 'text_delta').length).toBeGreaterThan(1)
  })
  it('lesson mode needs an existing lesson and puts its text in the system prompt', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    await expect(svc.createConversation({ mode: 'lesson', lessonId: ids[3] })).rejects.toThrow(/课程/)
    insertLesson(db, { id: ids[3], title: 'Lesson 5', body: 'Good morning, Mr. Blake.', source: 'text', notesZh: '', vocabulary: [], createdAt: 'x', assets: [] })
    const { conversation } = await svc.createConversation({ mode: 'lesson', lessonId: ids[3] })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('Lesson 5')
    expect(ai.calls[0].systemPrompt).toContain('Good morning, Mr. Blake.')
  })
  it('scenario title combines scenario and mode', async () => {
    const svc = mk(new FakeAIProvider())
    const { conversation } = await svc.createConversation({ mode: 'roleplay', scenario: '餐厅' })
    await svc.whenIdle(conversation.id)
    expect(conversation.title).toBe('餐厅 · 角色扮演')
  })
})

describe('send', () => {
  it('persists the user message, resumes the session, bumps turn count', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const { userMessage } = await svc.send({ conversationId: conversation.id, text: 'I goed to work', fromAsr: true })
    await svc.whenIdle(conversation.id)
    expect(userMessage).toMatchObject({ role: 'user', content: 'I goed to work', fromAsr: true, status: 'done' })
    expect(ai.calls[1]).toMatchObject({ firstTurn: false, text: 'I goed to work' })
    expect(ai.calls[1].systemPrompt).toBeUndefined()
    expect(listMessages(db, conversation.id).map((m) => m.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(getConversation(db, conversation.id)?.turnCount).toBe(1)
  })
  it('rejects a second send while a turn is in progress', async () => {
    const svc = mk(new FakeAIProvider({ deltaDelayMs: 20 }))
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await expect(svc.send({ conversationId: conversation.id, text: 'again' })).rejects.toThrow(/尚未结束/)
    await svc.whenIdle(conversation.id)
  })
  it('after a failed opening turn the next send is a first turn again', async () => {
    const ai = new FakeAIProvider({ failWith: 'not_logged_in' })
    const svc = mk(ai)
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    expect(listMessages(db, conversation.id)[0]).toMatchObject({ id: assistantMessageId, status: 'error' })
    expect(getConversation(db, conversation.id)?.sessionStarted).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'not_logged_in' })
    await svc.send({ conversationId: conversation.id, text: 'retry' })
    await svc.whenIdle(conversation.id)
    expect(ai.calls[1]).toMatchObject({ firstTurn: true })
    expect(ai.calls[1].systemPrompt).toContain('Learner level')
  })
  it('stores plain text and null structured when structured output is missing', async () => {
    const svc = mk(new FakeAIProvider({ omitStructured: true, reply: { reply: 'Just text' } }))
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m).toMatchObject({ content: 'Just text', structured: null, status: 'done' })
  })
  it('cancel marks the assistant message stopped and keeps partial text', async () => {
    const svc = mk(new FakeAIProvider({ deltaDelayMs: 15, reply: { reply: 'one two three four five six' } }))
    const { conversation, assistantMessageId } = await svc.createConversation({ mode: 'free' })
    await new Promise((r) => setTimeout(r, 40))
    svc.cancel(conversation.id)
    await svc.whenIdle(conversation.id)
    const m = listMessages(db, conversation.id).find((x) => x.id === assistantMessageId)!
    expect(m.status).toBe('stopped')
    expect(m.content.length).toBeGreaterThan(0)
    expect(m.content.length).toBeLessThan('one two three four five six'.length)
  })
  it('rejects unknown conversation', async () => {
    const svc = mk(new FakeAIProvider())
    await expect(svc.send({ conversationId: ids[3], text: 'x' })).rejects.toThrow(/会话/)
  })
})

describe('deleteConversation', () => {
  it('cancels, deletes rows and the Claude session', async () => {
    const ai = new FakeAIProvider()
    const svc = mk(ai)
    const { conversation } = await svc.createConversation({ mode: 'free' })
    await svc.whenIdle(conversation.id)
    await svc.deleteConversation(conversation.id)
    expect(listConversations(db)).toEqual([])
    expect(ai.deleted).toEqual([conversation.id])
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/chat`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 写 `src/main/chat/service.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { ChatIpcEvent, Conversation, CreateConversationInput, Message, SendMessageInput } from '@shared/types'
import { MODE_LABEL } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { Db } from '../db/index'
import { bumpTurn, deleteConversation, getConversation, insertConversation, markSessionStarted } from '../db/conversations'
import { insertMessage, updateMessage } from '../db/messages'
import { getLesson } from '../db/lessons'
import { getSettings } from '../db/settings'
import { buildSystemPrompt, OPENING_INSTRUCTION } from '../learning/prompts'

export interface ChatServiceDeps {
  db: Db
  ai: AIProvider
  send: (event: ChatIpcEvent) => void
  now?: () => string
  uuid?: () => string
}

interface ActiveTurn {
  ac: AbortController
  done: Promise<void>
}

export class ChatService {
  private readonly active = new Map<string, ActiveTurn>()
  private readonly now: () => string
  private readonly uuid: () => string

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.uuid = deps.uuid ?? randomUUID
  }

  async createConversation(input: CreateConversationInput): Promise<{ conversation: Conversation; assistantMessageId: string }> {
    const lesson = input.lessonId ? getLesson(this.deps.db, input.lessonId) : undefined
    if (input.mode === 'lesson' && !lesson) throw new Error('课程不存在')
    const title = lesson ? lesson.title : input.scenario ? `${input.scenario} · ${MODE_LABEL[input.mode]}` : MODE_LABEL[input.mode]
    const now = this.now()
    const conversation: Conversation = {
      id: this.uuid(), title, mode: input.mode, lessonId: lesson?.id ?? null, scenario: input.scenario ?? null,
      turnCount: 0, sessionStarted: false, createdAt: now, updatedAt: now, endedAt: null
    }
    insertConversation(this.deps.db, conversation)
    const assistantMessageId = this.startTurn(conversation, OPENING_INSTRUCTION)
    return { conversation, assistantMessageId }
  }

  async send(input: SendMessageInput): Promise<{ userMessage: Message; assistantMessageId: string }> {
    const conversation = getConversation(this.deps.db, input.conversationId)
    if (!conversation) throw new Error('会话不存在')
    if (this.active.has(conversation.id)) throw new Error('上一轮尚未结束')
    const userMessage: Message = {
      id: this.uuid(), conversationId: conversation.id, role: 'user', content: input.text,
      structured: null, status: 'done', fromAsr: input.fromAsr ?? false, createdAt: this.now()
    }
    insertMessage(this.deps.db, userMessage)
    bumpTurn(this.deps.db, conversation.id, userMessage.createdAt)
    const assistantMessageId = this.startTurn(conversation, input.text)
    return { userMessage, assistantMessageId }
  }

  cancel(conversationId: string): void {
    this.active.get(conversationId)?.ac.abort()
  }

  cancelAll(): void {
    for (const t of this.active.values()) t.ac.abort()
  }

  async whenIdle(conversationId: string): Promise<void> {
    await this.active.get(conversationId)?.done
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.cancel(conversationId)
    await this.whenIdle(conversationId)
    deleteConversation(this.deps.db, conversationId)
    await this.deps.ai.deleteSession(conversationId)
  }

  private startTurn(conversation: Conversation, text: string): string {
    const assistantMessageId = this.uuid()
    insertMessage(this.deps.db, {
      id: assistantMessageId, conversationId: conversation.id, role: 'assistant', content: '',
      structured: null, status: 'streaming', fromAsr: false, createdAt: this.now()
    })
    const ac = new AbortController()
    const done = this.runTurn(conversation.id, text, assistantMessageId, ac).finally(() => this.active.delete(conversation.id))
    this.active.set(conversation.id, { ac, done })
    return assistantMessageId
  }

  private async runTurn(conversationId: string, text: string, assistantMessageId: string, ac: AbortController): Promise<void> {
    const { db, ai, send } = this.deps
    const conversation = getConversation(db, conversationId)
    if (!conversation) return
    const settings = getSettings(db)
    const firstTurn = !conversation.sessionStarted
    let systemPrompt: string | undefined
    if (firstTurn) {
      const lesson = conversation.lessonId ? getLesson(db, conversation.lessonId) : undefined
      systemPrompt = buildSystemPrompt({
        mode: conversation.mode, difficulty: settings.difficulty, chineseExplanations: settings.chineseExplanations,
        lesson: lesson ? { title: lesson.title, body: lesson.body, notesZh: lesson.notesZh } : undefined,
        scenario: conversation.scenario ?? undefined
      })
    }
    let content = ''
    try {
      for await (const ev of ai.chat({ conversationId, firstTurn, systemPrompt, text, signal: ac.signal, model: settings.model || undefined })) {
        if (ev.type === 'text_delta') {
          content += ev.text
        } else if (ev.type === 'done') {
          const finalText = ev.structured?.reply ?? (content || ev.rawText)
          updateMessage(db, assistantMessageId, { content: finalText, structured: ev.structured ?? null, status: 'done' })
          if (firstTurn) markSessionStarted(db, conversationId)
        } else if (ev.type === 'error') {
          updateMessage(db, assistantMessageId, { content, structured: null, status: ev.kind === 'aborted' ? 'stopped' : 'error' })
        }
        send({ ...ev, conversationId, messageId: assistantMessageId })
      }
    } catch (e) {
      updateMessage(db, assistantMessageId, { content, structured: null, status: 'error' })
      send({ type: 'error', kind: 'unknown', message: String((e as Error)?.message ?? e), conversationId, messageId: assistantMessageId })
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/main/chat src/main/ai && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/chat src/main/ai/fake.ts
git commit -m "feat: ChatService（会话创建、开场轮、发送、取消、删除）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: LessonService

**Files:**
- Create: `src/main/lessons/service.ts`
- Test: `src/main/lessons/service.test.ts`

**Interfaces:**
- Consumes: Task 4 `AIProvider.analyze`；Task 6 `insertLesson` / `listLessons` / `getLesson` / `deleteLesson`；Task 3 `EXTRACT_LESSON_PROMPT`；Task 2 `LessonExtractionSchema`。
- Produces:

```ts
export interface LessonServiceDeps { db: Db; ai: AIProvider; lessonsDir: string; uuid?: () => string; now?: () => string }
export class LessonService {
  constructor(deps: LessonServiceDeps)
  extract(input: ExtractLessonInput, model?: string): Promise<LessonExtraction>
  save(input: SaveLessonInput): Lesson           // 写图片到 lessonsDir/<id>/<n>.<ext>
  list(): Lesson[]
  delete(id: string): Promise<void>              // 删行 + 删目录
}
```

- [ ] **Step 1: 写失败的测试 `src/main/lessons/service.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../db/index'
import { FakeAIProvider } from '../ai/fake'
import { LessonService } from './service'

let db: Db
let dir: string
const extraction = { title: 'Lesson 5', body: 'Good morning.', vocabulary: [{ word: 'morning', meaningZh: '早上', example: 'Good morning.' }], notesZh: '问候语。' }

beforeEach(() => {
  db = openDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'speakmate-lessons-'))
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
  it('writes image files, stores assets, lists newest first, deletes files', async () => {
    const svc = new LessonService({ db, ai: new FakeAIProvider(), lessonsDir: dir, uuid: () => 'l1' })
    const png = Buffer.from('fake-png').toString('base64')
    const lesson = svc.save({ ...extraction, source: 'image', images: [{ mime: 'image/png', base64: png }, { mime: 'image/jpeg', base64: png }] })
    expect(lesson.id).toBe('l1')
    expect(lesson.assets.map((a) => a.path)).toEqual([join(dir, 'l1', '0.png'), join(dir, 'l1', '1.jpg')])
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/lessons`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/lessons/service.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LessonExtractionSchema } from '@shared/schemas'
import type { ExtractLessonInput, Lesson, LessonAsset, LessonExtraction, SaveLessonInput } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { Db } from '../db/index'
import { deleteLesson, getLesson, insertLesson, listLessons } from '../db/lessons'
import { EXTRACT_LESSON_PROMPT } from '../learning/prompts'

export interface LessonServiceDeps {
  db: Db
  ai: AIProvider
  lessonsDir: string
  uuid?: () => string
  now?: () => string
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export class LessonService {
  private readonly uuid: () => string
  private readonly now: () => string

  constructor(private readonly deps: LessonServiceDeps) {
    this.uuid = deps.uuid ?? randomUUID
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  async extract(input: ExtractLessonInput, model?: string): Promise<LessonExtraction> {
    const hasImages = (input.images?.length ?? 0) > 0
    const text = hasImages
      ? 'Extract the English learning material from the attached image(s).' + (input.text?.trim() ? `\n\nExtra text from the learner:\n${input.text}` : '')
      : `Extract the English learning material from this text:\n\n${input.text}`
    return this.deps.ai.analyze({
      systemPrompt: EXTRACT_LESSON_PROMPT,
      text,
      images: hasImages ? input.images : undefined,
      schema: LessonExtractionSchema,
      model
    })
  }

  save(input: SaveLessonInput): Lesson {
    const id = this.uuid()
    const assets: LessonAsset[] = []
    if (input.images?.length) {
      const dir = join(this.deps.lessonsDir, id)
      mkdirSync(dir, { recursive: true })
      input.images.forEach((img, i) => {
        const path = join(dir, `${i}.${EXT[img.mime] ?? 'bin'}`)
        const buf = Buffer.from(img.base64, 'base64')
        writeFileSync(path, buf)
        assets.push({ id: this.uuid(), lessonId: id, path, mime: img.mime, size: buf.length })
      })
    }
    const lesson: Lesson = {
      id, title: input.title, body: input.body, source: input.source, notesZh: input.notesZh,
      vocabulary: input.vocabulary, createdAt: this.now(), assets
    }
    insertLesson(this.deps.db, lesson)
    return getLesson(this.deps.db, id)!
  }

  list(): Lesson[] {
    return listLessons(this.deps.db)
  }

  async delete(id: string): Promise<void> {
    deleteLesson(this.deps.db, id)
    rmSync(join(this.deps.lessonsDir, id), { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/lessons && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/lessons
git commit -m "feat: LessonService（识别、保存图片与课程、删除）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: IPC 注册、preload、路径与主进程入口

**Files:**
- Create: `src/main/paths.ts`、`src/main/ipc/handle.ts`、`src/main/ipc/register.ts`
- Modify: `src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`
- Test: `src/main/ipc/handle.test.ts`、`src/main/ipc/register.test.ts`

**Interfaces:**
- Consumes: Task 7 `ChatService`、Task 8 `LessonService`、Task 5 `ClaudeCliProvider`、Task 4 `FakeAIProvider`、Task 6 db 函数、Task 2 schema 与 `IPC`。
- Produces:

```ts
export interface AppPaths { userData: string; db: string; lessonsDir: string; sessionsDir: string; tmpDir: string; modelsDir: string }
export function resolvePaths(userData: string): AppPaths                       // 建目录
export type IpcHandleTarget = Pick<IpcMain, 'handle'>
export function registerHandler<I, O>(ipc: IpcHandleTarget, channel: string, schema: ZodType<I>, fn: (input: I) => Promise<O> | O): void
export function registerVoidHandler<O>(ipc: IpcHandleTarget, channel: string, fn: () => Promise<O> | O): void
export interface Services { chat: ChatService; lessons: LessonService; ai: AIProvider; db: Db }
export function registerIpc(ipc: IpcHandleTarget, services: Services, pickImages: () => Promise<ImageInput[]>): void
// preload 暴露 window.speakmate: SpeakMateAPI
```

- [ ] **Step 1: 写失败的测试 `src/main/ipc/handle.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { registerHandler, registerVoidHandler, type IpcHandleTarget } from './handle'

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>

function fakeIpc(): { ipc: IpcHandleTarget; handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>()
  const ipc = { handle: (channel: string, listener: Listener) => { handlers.set(channel, listener) } } as unknown as IpcHandleTarget
  return { ipc, handlers }
}

describe('registerHandler', () => {
  it('validates input and passes the parsed value', async () => {
    const { ipc, handlers } = fakeIpc()
    registerHandler(ipc, 'x', z.object({ n: z.number() }), (i) => i.n * 2)
    await expect(handlers.get('x')!({}, { n: 21 })).resolves.toBe(42)
    await expect(handlers.get('x')!({}, { n: 'no' })).rejects.toThrow(/参数无效（x）/)
  })
  it('void handlers ignore arguments', async () => {
    const { ipc, handlers } = fakeIpc()
    registerVoidHandler(ipc, 'y', () => 'ok')
    await expect(handlers.get('y')!({}, 'junk')).resolves.toBe('ok')
  })
})
```

- [ ] **Step 2: 写失败的测试 `src/main/ipc/register.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { IPC } from '@shared/ipc'
import { openDatabase } from '../db/index'
import { FakeAIProvider } from '../ai/fake'
import { ChatService } from '../chat/service'
import { LessonService } from '../lessons/service'
import { registerIpc } from './register'
import type { IpcHandleTarget } from './handle'

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>

describe('registerIpc', () => {
  it('wires channels end to end with real services', async () => {
    const handlers = new Map<string, Listener>()
    const ipc = { handle: (c: string, l: Listener) => handlers.set(c, l) } as unknown as IpcHandleTarget
    const db = openDatabase(':memory:')
    const ai = new FakeAIProvider()
    const chat = new ChatService({ db, ai, send: () => {} })
    const lessons = new LessonService({ db, ai, lessonsDir: '/tmp/speakmate-test-lessons' })
    registerIpc(ipc, { chat, lessons, ai, db }, async () => [])
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC).filter((c) => c !== IPC.chatEvent).sort())

    const created = (await handlers.get(IPC.conversationsCreate)!({}, { mode: 'free' })) as { conversation: { id: string } }
    await chat.whenIdle(created.conversation.id)
    const list = (await handlers.get(IPC.conversationsList)!({})) as unknown[]
    expect(list).toHaveLength(1)
    const msgs = (await handlers.get(IPC.messagesList)!({}, created.conversation.id)) as unknown[]
    expect(msgs).toHaveLength(1)
    await expect(handlers.get(IPC.conversationsCreate)!({}, { mode: 'nope' })).rejects.toThrow(/参数无效/)
    const settings = (await handlers.get(IPC.settingsPatch)!({}, { difficulty: 'beginner' })) as { difficulty: string }
    expect(settings.difficulty).toBe('beginner')
    expect(await handlers.get(IPC.aiCheck)!({})).toMatchObject({ ok: true })
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/ipc`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 写 `src/main/paths.ts`**

```ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface AppPaths {
  userData: string
  db: string
  lessonsDir: string
  sessionsDir: string
  tmpDir: string
  modelsDir: string
}

export function resolvePaths(userData: string): AppPaths {
  const paths: AppPaths = {
    userData,
    db: join(userData, 'speakmate.db'),
    lessonsDir: join(userData, 'lessons'),
    sessionsDir: join(userData, 'claude-sessions'),
    tmpDir: join(userData, 'tmp'),
    modelsDir: join(userData, 'models')
  }
  for (const dir of [paths.lessonsDir, paths.sessionsDir, paths.tmpDir, paths.modelsDir]) mkdirSync(dir, { recursive: true })
  return paths
}
```

- [ ] **Step 5: 写 `src/main/ipc/handle.ts`**

```ts
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'

export type IpcHandleTarget = Pick<IpcMain, 'handle'>

export function registerHandler<I, O>(ipc: IpcHandleTarget, channel: string, schema: ZodType<I>, fn: (input: I) => Promise<O> | O): void {
  ipc.handle(channel, async (_event: IpcMainInvokeEvent, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      throw new Error(`参数无效（${channel}）：${detail}`)
    }
    return fn(parsed.data)
  })
}

export function registerVoidHandler<O>(ipc: IpcHandleTarget, channel: string, fn: () => Promise<O> | O): void {
  ipc.handle(channel, async () => fn())
}
```

- [ ] **Step 6: 写 `src/main/ipc/register.ts`**

```ts
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  ConversationIdSchema, CreateConversationInputSchema, ExtractLessonInputSchema,
  SaveLessonInputSchema, SendMessageInputSchema, SettingsPatchSchema
} from '@shared/schemas'
import type { ImageInput } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { ChatService } from '../chat/service'
import type { LessonService } from '../lessons/service'
import type { Db } from '../db/index'
import { listConversations } from '../db/conversations'
import { listMessages } from '../db/messages'
import { getSettings, patchSettings } from '../db/settings'
import { registerHandler, registerVoidHandler, type IpcHandleTarget } from './handle'

export interface Services {
  chat: ChatService
  lessons: LessonService
  ai: AIProvider
  db: Db
}

export function registerIpc(ipc: IpcHandleTarget, { chat, lessons, ai, db }: Services, pickImages: () => Promise<ImageInput[]>): void {
  registerVoidHandler(ipc, IPC.conversationsList, () => listConversations(db))
  registerHandler(ipc, IPC.conversationsCreate, CreateConversationInputSchema, (i) => chat.createConversation(i))
  registerHandler(ipc, IPC.conversationsDelete, ConversationIdSchema, (id) => chat.deleteConversation(id))
  registerHandler(ipc, IPC.messagesList, ConversationIdSchema, (id) => listMessages(db, id))
  registerHandler(ipc, IPC.chatSend, SendMessageInputSchema, (i) => chat.send(i))
  registerHandler(ipc, IPC.chatCancel, ConversationIdSchema, (id) => { chat.cancel(id) })
  registerVoidHandler(ipc, IPC.lessonsList, () => lessons.list())
  registerHandler(ipc, IPC.lessonsExtract, ExtractLessonInputSchema, (i) => lessons.extract(i, getSettings(db).model || undefined))
  registerHandler(ipc, IPC.lessonsSave, SaveLessonInputSchema, (i) => lessons.save(i))
  registerHandler(ipc, IPC.lessonsDelete, z.string().uuid(), (id) => lessons.delete(id))
  registerVoidHandler(ipc, IPC.settingsGet, () => getSettings(db))
  registerHandler(ipc, IPC.settingsPatch, SettingsPatchSchema, (p) => patchSettings(db, p))
  registerVoidHandler(ipc, IPC.aiCheck, () => ai.check())
  registerVoidHandler(ipc, IPC.imagePick, () => pickImages())
}
```

- [ ] **Step 7: 重写 `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { ChatIpcEvent, ImageInput } from '@shared/types'
import { createWindow, installCsp } from './window'
import { resolvePaths } from './paths'
import { openDatabase } from './db/index'
import type { AIProvider } from './ai/types'
import { FakeAIProvider } from './ai/fake'
import { ClaudeCliProvider } from './ai/claude-cli'
import { ChatService } from './chat/service'
import { LessonService } from './lessons/service'
import { registerIpc } from './ipc/register'

const MIME_BY_EXT: Record<string, ImageInput['mime']> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const MAX_PICK_BYTES = 12 * 1024 * 1024

async function pickImages(): Promise<ImageInput[]> {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  })
  const out: ImageInput[] = []
  for (const p of r.filePaths.slice(0, 4)) {
    const mime = MIME_BY_EXT[extname(p).toLowerCase()]
    if (!mime || statSync(p).size > MAX_PICK_BYTES) continue
    out.push({ mime, base64: readFileSync(p).toString('base64'), name: basename(p) })
  }
  return out
}

let chat: ChatService | undefined

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.speakmate.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  installCsp()

  const paths = resolvePaths(app.getPath('userData'))
  const db = openDatabase(paths.db)
  const ai: AIProvider =
    process.env.SPEAKMATE_FAKE_AI === '1' ? new FakeAIProvider({ deltaDelayMs: 40 }) : new ClaudeCliProvider({ sessionsDir: paths.sessionsDir })
  const send = (event: ChatIpcEvent): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.chatEvent, event)
  }
  chat = new ChatService({ db, ai, send })
  const lessons = new LessonService({ db, ai, lessonsDir: paths.lessonsDir })
  registerIpc(ipcMain, { chat, lessons, ai, db }, pickImages)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => chat?.cancelAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 8: 写 `src/preload/index.ts` 与 `index.d.ts`**

`src/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SpeakMateAPI } from '@shared/ipc'
import type { ChatIpcEvent } from '@shared/types'

const api: SpeakMateAPI = {
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    create: (input) => ipcRenderer.invoke(IPC.conversationsCreate, input),
    delete: (id) => ipcRenderer.invoke(IPC.conversationsDelete, id)
  },
  messages: {
    list: (conversationId) => ipcRenderer.invoke(IPC.messagesList, conversationId)
  },
  chat: {
    send: (input) => ipcRenderer.invoke(IPC.chatSend, input),
    cancel: (conversationId) => ipcRenderer.invoke(IPC.chatCancel, conversationId),
    onEvent: (cb) => {
      const listener = (_e: unknown, event: ChatIpcEvent): void => cb(event)
      ipcRenderer.on(IPC.chatEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.chatEvent, listener)
      }
    }
  },
  lessons: {
    list: () => ipcRenderer.invoke(IPC.lessonsList),
    extract: (input) => ipcRenderer.invoke(IPC.lessonsExtract, input),
    save: (input) => ipcRenderer.invoke(IPC.lessonsSave, input),
    delete: (id) => ipcRenderer.invoke(IPC.lessonsDelete, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    patch: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch)
  },
  ai: {
    check: () => ipcRenderer.invoke(IPC.aiCheck)
  },
  image: {
    pick: () => ipcRenderer.invoke(IPC.imagePick)
  }
}

contextBridge.exposeInMainWorld('speakmate', api)
```

`src/preload/index.d.ts`：

```ts
import type { SpeakMateAPI } from '../shared/ipc'

declare global {
  interface Window {
    speakmate: SpeakMateAPI
  }
}

export {}
```

- [ ] **Step 9: 跑测试与手动验证**

Run: `npx vitest run && npm run typecheck`
Expected: 全部 PASS。

Run: `npm run dev:fake`，窗口出现后打开开发者工具（Cmd+Option+I），在 Console 执行：

```js
const r = await window.speakmate.conversations.create({ mode: 'free' }); r
await new Promise(res => setTimeout(res, 1500))
await window.speakmate.messages.list(r.conversation.id)
await window.speakmate.conversations.create({ mode: 'nope' })
```

Expected: 第一条返回 `{ conversation, assistantMessageId }`；第三条返回一条 assistant 消息，`content` 为 Fake 的开场白，`structured` 非空；第四条 reject，信息含"参数无效"。关闭窗口。

- [ ] **Step 10: 提交**

```bash
git add src/main src/preload
git commit -m "feat: IPC 注册、preload API、路径与主进程装配

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 渲染进程基础：状态机、reducer、Store

**Files:**
- Create: `src/renderer/src/api.ts`、`src/renderer/src/state/machine.ts`、`src/renderer/src/state/chatReducer.ts`、`src/renderer/src/store/ChatStore.tsx`
- Test: `src/renderer/src/state/machine.test.ts`、`src/renderer/src/state/chatReducer.test.ts`

**Interfaces:**
- Consumes: Task 2 类型、Task 9 的 `window.speakmate`。
- Produces:

```ts
// machine.ts
export type UiState = 'idle' | 'recording' | 'transcribing' | 'awaiting_confirmation' | 'sending' | 'streaming' | 'speaking' | 'error'
export type UiEvent = 'SEND' | 'FIRST_DELTA' | 'DONE' | 'FAIL' | 'STOP' | 'START_RECORDING' | 'STOP_RECORDING' | 'TRANSCRIBED' | 'INPUT_CLEARED' | 'SPEAK' | 'SPEAK_END' | 'RESET'
export function transition(state: UiState, event: UiEvent): UiState
export const canSend: (s: UiState) => boolean
export const canRecord: (s: UiState) => boolean
export const isBusy: (s: UiState) => boolean
// chatReducer.ts
export interface ChatState { conversations: Conversation[]; currentId: string | null; messages: Record<string, Message[]>; ui: Record<string, UiState>; errors: Record<string, string | undefined>; retrying: Record<string, number | undefined> }
export type ChatAction = ...（见代码）
export const initialState: ChatState
export function chatReducer(state: ChatState, action: ChatAction): ChatState
export const uiOf: (state: ChatState, id: string | null) => UiState
// ChatStore.tsx
export function ChatProvider(props: { children: ReactNode }): JSX.Element
export function useChat(): ChatContextValue   // { state, settings, current, currentMessages, select, createConversation, sendMessage, cancel, deleteConversation, refreshConversations, patchSettings }
```

- [ ] **Step 1: 写失败的测试 `src/renderer/src/state/machine.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { transition, canSend, canRecord, isBusy } from './machine'

describe('transition', () => {
  it('walks the happy text path', () => {
    expect(transition('idle', 'SEND')).toBe('sending')
    expect(transition('sending', 'FIRST_DELTA')).toBe('streaming')
    expect(transition('streaming', 'DONE')).toBe('idle')
    expect(transition('idle', 'SPEAK')).toBe('speaking')
    expect(transition('speaking', 'SPEAK_END')).toBe('idle')
  })
  it('walks the voice path', () => {
    expect(transition('idle', 'START_RECORDING')).toBe('recording')
    expect(transition('recording', 'STOP_RECORDING')).toBe('transcribing')
    expect(transition('transcribing', 'TRANSCRIBED')).toBe('awaiting_confirmation')
    expect(transition('awaiting_confirmation', 'SEND')).toBe('sending')
    expect(transition('awaiting_confirmation', 'INPUT_CLEARED')).toBe('idle')
  })
  it('ignores illegal events', () => {
    expect(transition('transcribing', 'START_RECORDING')).toBe('transcribing')
    expect(transition('streaming', 'SEND')).toBe('streaming')
    expect(transition('idle', 'DONE')).toBe('idle')
  })
  it('stop and failure', () => {
    expect(transition('streaming', 'STOP')).toBe('idle')
    expect(transition('sending', 'FAIL')).toBe('error')
    expect(transition('error', 'RESET')).toBe('idle')
    expect(transition('error', 'SEND')).toBe('sending')
    expect(transition('speaking', 'SEND')).toBe('sending')
    expect(transition('speaking', 'START_RECORDING')).toBe('recording')
  })
  it('guards', () => {
    expect(canSend('idle')).toBe(true)
    expect(canSend('streaming')).toBe(false)
    expect(canRecord('transcribing')).toBe(false)
    expect(isBusy('sending')).toBe(true)
    expect(isBusy('speaking')).toBe(false)
  })
})
```

- [ ] **Step 2: 写失败的测试 `src/renderer/src/state/chatReducer.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { chatReducer, initialState, uiOf, type ChatState } from './chatReducer'
import type { Conversation, Message } from '@shared/types'

const conv = (id: string): Conversation => ({ id, title: 't', mode: 'free', lessonId: null, scenario: null, turnCount: 0, sessionStarted: true, createdAt: '', updatedAt: '', endedAt: null })
const asst = (id: string, conversationId: string): Message => ({ id, conversationId, role: 'assistant', content: '', structured: null, status: 'streaming', fromAsr: false, createdAt: '' })

function withTwoConversations(): ChatState {
  let s = chatReducer(initialState, { type: 'conversations/loaded', conversations: [conv('a'), conv('b')] })
  s = chatReducer(s, { type: 'conversation/selected', id: 'a' })
  s = chatReducer(s, { type: 'messages/loaded', conversationId: 'b', messages: [asst('m-b', 'b')] })
  s = chatReducer(s, { type: 'ui', conversationId: 'b', event: 'SEND' })
  return s
}

describe('chatReducer', () => {
  it('applies deltas to the right message even when another conversation is selected', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'text_delta', text: 'Hel', conversationId: 'b', messageId: 'm-b' } })
    s = chatReducer(s, { type: 'chat/event', event: { type: 'text_delta', text: 'lo', conversationId: 'b', messageId: 'm-b' } })
    expect(s.currentId).toBe('a')
    expect(s.messages.b[0].content).toBe('Hello')
    expect(uiOf(s, 'b')).toBe('streaming')
    expect(uiOf(s, 'a')).toBe('idle')
  })
  it('done stores structured output and uses its reply as the final text', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'text_delta', text: 'partial', conversationId: 'b', messageId: 'm-b' } })
    s = chatReducer(s, { type: 'chat/event', event: { type: 'done', structured: { reply: 'Full reply.' }, rawText: 'partial', conversationId: 'b', messageId: 'm-b' } })
    expect(s.messages.b[0]).toMatchObject({ content: 'Full reply.', status: 'done', structured: { reply: 'Full reply.' } })
    expect(uiOf(s, 'b')).toBe('idle')
  })
  it('done without structured keeps streamed text', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'text_delta', text: 'plain', conversationId: 'b', messageId: 'm-b' } })
    s = chatReducer(s, { type: 'chat/event', event: { type: 'done', rawText: 'plain', conversationId: 'b', messageId: 'm-b' } })
    expect(s.messages.b[0]).toMatchObject({ content: 'plain', status: 'done', structured: null })
  })
  it('aborted error marks stopped without an error banner; other errors mark error', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'error', kind: 'aborted', message: 'x', conversationId: 'b', messageId: 'm-b' } })
    expect(s.messages.b[0].status).toBe('stopped')
    expect(s.errors.b).toBeUndefined()
    expect(uiOf(s, 'b')).toBe('idle')
    let t = withTwoConversations()
    t = chatReducer(t, { type: 'chat/event', event: { type: 'error', kind: 'not_logged_in', message: 'login', conversationId: 'b', messageId: 'm-b' } })
    expect(t.messages.b[0].status).toBe('error')
    expect(t.errors.b).toBe('not_logged_in')
    expect(uiOf(t, 'b')).toBe('error')
  })
  it('retrying is recorded and cleared on done', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'retrying', attempt: 2, conversationId: 'b', messageId: 'm-b' } })
    expect(s.retrying.b).toBe(2)
    s = chatReducer(s, { type: 'chat/event', event: { type: 'done', rawText: '', conversationId: 'b', messageId: 'm-b' } })
    expect(s.retrying.b).toBeUndefined()
  })
  it('creates placeholder assistant message for unknown messageId', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'chat/event', event: { type: 'text_delta', text: 'x', conversationId: 'a', messageId: 'new' } })
    expect(s.messages.a?.[0]).toMatchObject({ id: 'new', role: 'assistant', content: 'x' })
  })
  it('conversation/created prepends and selects; deleted removes', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'conversation/created', conversation: conv('c'), assistantMessageId: 'm-c' })
    expect(s.conversations.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(s.currentId).toBe('c')
    expect(s.messages.c).toHaveLength(1)
    expect(uiOf(s, 'c')).toBe('sending')
    s = chatReducer(s, { type: 'conversation/deleted', id: 'c' })
    expect(s.conversations.map((c) => c.id)).toEqual(['a', 'b'])
    expect(s.currentId).toBe('a')
  })
  it('message/userSent appends the user message and a streaming placeholder', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'messages/loaded', conversationId: 'a', messages: [] })
    const user: Message = { id: 'u1', conversationId: 'a', role: 'user', content: 'hi', structured: null, status: 'done', fromAsr: false, createdAt: '' }
    s = chatReducer(s, { type: 'message/userSent', userMessage: user, assistantMessageId: 'a1' })
    expect(s.messages.a.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(uiOf(s, 'a')).toBe('sending')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/renderer`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 写 `src/renderer/src/state/machine.ts`**

```ts
export type UiState = 'idle' | 'recording' | 'transcribing' | 'awaiting_confirmation' | 'sending' | 'streaming' | 'speaking' | 'error'
export type UiEvent = 'SEND' | 'FIRST_DELTA' | 'DONE' | 'FAIL' | 'STOP' | 'START_RECORDING' | 'STOP_RECORDING' | 'TRANSCRIBED' | 'INPUT_CLEARED' | 'SPEAK' | 'SPEAK_END' | 'RESET'

const TABLE: Record<UiState, Partial<Record<UiEvent, UiState>>> = {
  idle: { SEND: 'sending', START_RECORDING: 'recording', SPEAK: 'speaking' },
  awaiting_confirmation: { SEND: 'sending', START_RECORDING: 'recording', INPUT_CLEARED: 'idle', SPEAK: 'speaking' },
  recording: { STOP_RECORDING: 'transcribing', FAIL: 'error', STOP: 'idle' },
  transcribing: { TRANSCRIBED: 'awaiting_confirmation', FAIL: 'error', STOP: 'idle' },
  sending: { FIRST_DELTA: 'streaming', DONE: 'idle', FAIL: 'error', STOP: 'idle' },
  streaming: { DONE: 'idle', FAIL: 'error', STOP: 'idle' },
  speaking: { SPEAK_END: 'idle', SEND: 'sending', START_RECORDING: 'recording', STOP: 'idle' },
  error: { RESET: 'idle', SEND: 'sending', START_RECORDING: 'recording' }
}

export function transition(state: UiState, event: UiEvent): UiState {
  return TABLE[state][event] ?? state
}

export const canSend = (s: UiState): boolean => s === 'idle' || s === 'awaiting_confirmation' || s === 'speaking' || s === 'error'
export const canRecord = canSend
export const isBusy = (s: UiState): boolean => s === 'sending' || s === 'streaming'
```

- [ ] **Step 5: 写 `src/renderer/src/state/chatReducer.ts`**

```ts
import type { ChatIpcEvent, Conversation, Message } from '@shared/types'
import { transition, type UiEvent, type UiState } from './machine'

export interface ChatState {
  conversations: Conversation[]
  currentId: string | null
  messages: Record<string, Message[]>
  ui: Record<string, UiState>
  errors: Record<string, string | undefined>   // 存 AIErrorKind，UI 按 kind 查文案
  retrying: Record<string, number | undefined>
}

export type ChatAction =
  | { type: 'conversations/loaded'; conversations: Conversation[] }
  | { type: 'conversation/created'; conversation: Conversation; assistantMessageId: string }
  | { type: 'conversation/selected'; id: string | null }
  | { type: 'conversation/deleted'; id: string }
  | { type: 'messages/loaded'; conversationId: string; messages: Message[] }
  | { type: 'message/userSent'; userMessage: Message; assistantMessageId: string }
  | { type: 'chat/event'; event: ChatIpcEvent }
  | { type: 'ui'; conversationId: string; event: UiEvent }
  | { type: 'error/cleared'; conversationId: string }

export const initialState: ChatState = { conversations: [], currentId: null, messages: {}, ui: {}, errors: {}, retrying: {} }

export const uiOf = (state: ChatState, id: string | null): UiState => (id ? (state.ui[id] ?? 'idle') : 'idle')

const placeholder = (id: string, conversationId: string): Message => ({
  id, conversationId, role: 'assistant', content: '', structured: null, status: 'streaming', fromAsr: false, createdAt: new Date().toISOString()
})

function withUi(state: ChatState, conversationId: string, event: UiEvent): ChatState {
  return { ...state, ui: { ...state.ui, [conversationId]: transition(uiOf(state, conversationId), event) } }
}

function patchMessage(state: ChatState, conversationId: string, messageId: string, fn: (m: Message) => Message): ChatState {
  const list = state.messages[conversationId] ?? []
  const idx = list.findIndex((m) => m.id === messageId)
  const next = idx === -1 ? [...list, fn(placeholder(messageId, conversationId))] : list.map((m, i) => (i === idx ? fn(m) : m))
  return { ...state, messages: { ...state.messages, [conversationId]: next } }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'conversations/loaded':
      return { ...state, conversations: action.conversations, currentId: state.currentId ?? action.conversations[0]?.id ?? null }
    case 'conversation/created': {
      const s: ChatState = {
        ...state,
        conversations: [action.conversation, ...state.conversations],
        currentId: action.conversation.id,
        messages: { ...state.messages, [action.conversation.id]: [placeholder(action.assistantMessageId, action.conversation.id)] }
      }
      return withUi(s, action.conversation.id, 'SEND')
    }
    case 'conversation/selected':
      return { ...state, currentId: action.id }
    case 'conversation/deleted': {
      const conversations = state.conversations.filter((c) => c.id !== action.id)
      const messages = { ...state.messages }
      delete messages[action.id]
      return { ...state, conversations, messages, currentId: state.currentId === action.id ? (conversations[0]?.id ?? null) : state.currentId }
    }
    case 'messages/loaded':
      return { ...state, messages: { ...state.messages, [action.conversationId]: action.messages } }
    case 'message/userSent': {
      const id = action.userMessage.conversationId
      const list = [...(state.messages[id] ?? []), action.userMessage, placeholder(action.assistantMessageId, id)]
      const s: ChatState = { ...state, messages: { ...state.messages, [id]: list }, errors: { ...state.errors, [id]: undefined } }
      return withUi(s, id, 'SEND')
    }
    case 'ui':
      return withUi(state, action.conversationId, action.event)
    case 'error/cleared':
      return withUi({ ...state, errors: { ...state.errors, [action.conversationId]: undefined } }, action.conversationId, 'RESET')
    case 'chat/event': {
      const ev = action.event
      const cid = ev.conversationId
      switch (ev.type) {
        case 'text_delta':
          return withUi(patchMessage(state, cid, ev.messageId, (m) => ({ ...m, content: m.content + ev.text })), cid, 'FIRST_DELTA')
        case 'retrying':
          return { ...state, retrying: { ...state.retrying, [cid]: ev.attempt } }
        case 'done': {
          const s = patchMessage(state, cid, ev.messageId, (m) => ({
            ...m, content: ev.structured?.reply ?? (m.content || ev.rawText), structured: ev.structured ?? null, status: 'done'
          }))
          return withUi({ ...s, retrying: { ...s.retrying, [cid]: undefined } }, cid, 'DONE')
        }
        case 'error': {
          const aborted = ev.kind === 'aborted'
          const s = patchMessage(state, cid, ev.messageId, (m) => ({ ...m, status: aborted ? 'stopped' : 'error' }))
          const t: ChatState = { ...s, retrying: { ...s.retrying, [cid]: undefined }, errors: { ...s.errors, [cid]: aborted ? undefined : ev.kind } }
          return withUi(t, cid, aborted ? 'STOP' : 'FAIL')
        }
      }
    }
  }
  return state
}
```

- [ ] **Step 6: 写 `src/renderer/src/api.ts` 与 `src/renderer/src/store/ChatStore.tsx`**

`api.ts`：

```ts
import type { SpeakMateAPI } from '@shared/ipc'

export const api: SpeakMateAPI = window.speakmate
```

`store/ChatStore.tsx`：

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import type { AppSettings, Conversation, CreateConversationInput, Message, SettingsPatch } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'
import { chatReducer, initialState, uiOf, type ChatState } from '../state/chatReducer'
import type { UiEvent, UiState } from '../state/machine'

export interface ChatContextValue {
  state: ChatState
  settings: AppSettings
  current: Conversation | null
  currentMessages: Message[]
  ui: UiState
  select(id: string): Promise<void>
  createConversation(input: CreateConversationInput): Promise<Conversation>
  sendMessage(text: string, fromAsr?: boolean): Promise<void>
  cancel(): Promise<void>
  deleteConversation(id: string): Promise<void>
  dispatchUi(event: UiEvent): void
  clearError(): void
  patchSettings(patch: SettingsPatch): Promise<void>
}

const Ctx = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void api.conversations.list().then((conversations) => dispatch({ type: 'conversations/loaded', conversations }))
    void api.settings.get().then(setSettings)
    return api.chat.onEvent((event) => dispatch({ type: 'chat/event', event }))
  }, [])

  const currentId = state.currentId
  useEffect(() => {
    if (currentId && !state.messages[currentId]) {
      void api.messages.list(currentId).then((messages) => dispatch({ type: 'messages/loaded', conversationId: currentId, messages }))
    }
  }, [currentId, state.messages])

  const select = useCallback(async (id: string) => dispatch({ type: 'conversation/selected', id }), [])

  const createConversation = useCallback(async (input: CreateConversationInput) => {
    const { conversation, assistantMessageId } = await api.conversations.create(input)
    dispatch({ type: 'conversation/created', conversation, assistantMessageId })
    return conversation
  }, [])

  const sendMessage = useCallback(async (text: string, fromAsr = false) => {
    if (!currentId) return
    const { userMessage, assistantMessageId } = await api.chat.send({ conversationId: currentId, text, fromAsr })
    dispatch({ type: 'message/userSent', userMessage, assistantMessageId })
  }, [currentId])

  const cancel = useCallback(async () => {
    if (currentId) await api.chat.cancel(currentId)
  }, [currentId])

  const deleteConversation = useCallback(async (id: string) => {
    await api.conversations.delete(id)
    dispatch({ type: 'conversation/deleted', id })
  }, [])

  const dispatchUi = useCallback((event: UiEvent) => {
    if (currentId) dispatch({ type: 'ui', conversationId: currentId, event })
  }, [currentId])

  const clearError = useCallback(() => {
    if (currentId) dispatch({ type: 'error/cleared', conversationId: currentId })
  }, [currentId])

  const patchSettings = useCallback(async (patch: SettingsPatch) => setSettings(await api.settings.patch(patch)), [])

  const value = useMemo<ChatContextValue>(() => ({
    state, settings,
    current: state.conversations.find((c) => c.id === currentId) ?? null,
    currentMessages: currentId ? (state.messages[currentId] ?? []) : [],
    ui: uiOf(state, currentId),
    select, createConversation, sendMessage, cancel, deleteConversation, dispatchUi, clearError, patchSettings
  }), [state, settings, currentId, select, createConversation, sendMessage, cancel, deleteConversation, dispatchUi, clearError, patchSettings])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChat(): ChatContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be used inside ChatProvider')
  return v
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/renderer && npm run typecheck`
Expected: PASS。若 `tsconfig.web.json` 对 `React.JSX.Element` 报错，在文件顶部补 `import type React from 'react'`。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/api.ts src/renderer/src/state src/renderer/src/store
git commit -m "feat: 渲染进程状态机、聊天 reducer 与 Store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 聊天页界面

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`、`ChatPage.tsx`、`ConversationList.tsx`、`MessageList.tsx`、`MessageBubble.tsx`、`CorrectionCard.tsx`、`VocabChips.tsx`、`InputBar.tsx`、`StatePill.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: Task 10 `useChat()`、`ChatProvider`、`canSend`、`isBusy`；Task 2 `MODE_LABEL`、`Message`。
- Produces: `App` 内部的 `Page = 'chat' | 'lessons' | 'settings'`；`ChatPage` 接受 `onOpenLessonDialog(files?: File[]) => void`（Task 12 实现，这里先接一个空函数）。

- [ ] **Step 1: `App.tsx` 与 `Sidebar.tsx`**

`App.tsx`：

```tsx
import { useState } from 'react'
import { ChatProvider } from './store/ChatStore'
import { Sidebar, type Page } from './components/Sidebar'
import { ChatPage } from './components/ChatPage'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('chat')
  return (
    <ChatProvider>
      <div className="h-full flex bg-surface text-fg">
        <Sidebar page={page} onChange={setPage} />
        <main className="flex-1 min-w-0 flex">
          {page === 'chat' && <ChatPage onOpenLessonDialog={() => {}} />}
          {page === 'lessons' && <div className="p-6 text-fg-2">课程页在 Task 12 实现</div>}
          {page === 'settings' && <div className="p-6 text-fg-2">设置页在 Task 13 实现</div>}
        </main>
      </div>
    </ChatProvider>
  )
}
```

`components/Sidebar.tsx`：

```tsx
export type Page = 'chat' | 'lessons' | 'settings'

const ITEMS: Array<{ key: Page | 'mistakes' | 'vocab' | 'analysis'; label: string; icon: string; disabled?: boolean }> = [
  { key: 'chat', label: '聊天', icon: '💬' },
  { key: 'lessons', label: '课程', icon: '📄' },
  { key: 'mistakes', label: '错句本', icon: '✎', disabled: true },
  { key: 'vocab', label: '生词本', icon: 'Aa', disabled: true },
  { key: 'analysis', label: '学习分析', icon: '◔', disabled: true },
  { key: 'settings', label: '设置', icon: '⚙' }
]

export function Sidebar({ page, onChange }: { page: Page; onChange: (p: Page) => void }): React.JSX.Element {
  return (
    <nav className="w-[170px] shrink-0 bg-surface-2 border-r border-line pt-10 px-2 pb-3 flex flex-col gap-0.5">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          disabled={it.disabled}
          title={it.disabled ? '阶段 3 提供' : undefined}
          onClick={() => !it.disabled && onChange(it.key as Page)}
          className={`text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 disabled:opacity-40 ${page === it.key ? 'bg-accent-soft text-accent font-semibold' : 'text-fg-2 hover:bg-line/40'}`}
        >
          <span className="w-4 text-center text-fg-3">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: `StatePill.tsx`、`CorrectionCard.tsx`、`VocabChips.tsx`**

`components/StatePill.tsx`：

```tsx
import type { UiState } from '../state/machine'

const STYLE: Record<UiState, string> = {
  idle: 'bg-surface-2 text-fg-2 border-line',
  recording: 'bg-bad-soft text-bad border-transparent',
  transcribing: 'bg-warn-soft text-warn border-transparent',
  awaiting_confirmation: 'bg-good-soft text-good border-transparent',
  sending: 'bg-warn-soft text-warn border-transparent',
  streaming: 'bg-warn-soft text-warn border-transparent',
  speaking: 'bg-good-soft text-good border-transparent',
  error: 'bg-bad-soft text-bad border-transparent'
}

export function StatePill({ state }: { state: UiState }): React.JSX.Element {
  return <span className={`font-mono text-[11px] px-2 py-0.5 rounded border ${STYLE[state]}`}>{state}</span>
}
```

`components/CorrectionCard.tsx`：

```tsx
import type { TutorResponse } from '@shared/types'

const CATEGORY: Record<string, string> = { grammar: '语法', word_choice: '用词', naturalness: '地道程度', other: '其他' }

export function CorrectionCard({ correction }: { correction: NonNullable<TutorResponse['correction']> }): React.JSX.Element {
  return (
    <details className="border border-line rounded-lg overflow-hidden w-full selectable">
      <summary className="cursor-pointer px-2.5 py-1.5 bg-surface-2 text-[12.5px] flex items-center gap-2 list-none">
        <span className="text-[11px] px-1.5 rounded bg-warn-soft text-warn">纠错 · {CATEGORY[correction.category] ?? '其他'}</span>
        {correction.uncertain && <span className="text-[11px] px-1.5 rounded border border-dashed border-line text-fg-3">可能是识别错误</span>}
        <span className="line-through text-bad truncate">{correction.original}</span>
      </summary>
      <div className="px-2.5 py-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[13px]">
        <span className="text-fg-3 text-[11.5px]">原句</span><span className="line-through text-bad">{correction.original}</span>
        <span className="text-fg-3 text-[11.5px]">改为</span><span className="text-good font-semibold">{correction.improved}</span>
        <span className="text-fg-3 text-[11.5px]">解释</span><span className="text-zh">{correction.explanationZh}</span>
      </div>
    </details>
  )
}
```

`components/VocabChips.tsx`：

```tsx
import type { TutorResponse } from '@shared/types'

export function VocabChips({ vocabulary }: { vocabulary: NonNullable<TutorResponse['vocabulary']> }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {vocabulary.map((v) => (
        <details key={v.word} className="relative">
          <summary className="cursor-pointer list-none text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent">{v.word}</summary>
          <div className="mt-1.5 px-2.5 py-2 border border-line rounded-lg bg-surface text-[12.5px] max-w-[320px] selectable">
            <div><b>{v.word}</b> <span className="text-zh">{v.meaningZh}</span></div>
            <div className="italic text-fg-2">{v.example}</div>
          </div>
        </details>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: `MessageBubble.tsx` 与 `MessageList.tsx`**

`components/MessageBubble.tsx`：

```tsx
import type { Message } from '@shared/types'
import { CorrectionCard } from './CorrectionCard'
import { VocabChips } from './VocabChips'

export function MessageBubble({ message }: { message: Message }): React.JSX.Element {
  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'
  return (
    <div className={`flex flex-col gap-1.5 max-w-[78%] ${isUser ? 'self-end items-end' : 'self-start'}`}>
      <div className={`px-3 py-2 rounded-xl whitespace-pre-wrap selectable ${isUser ? 'bg-accent text-white rounded-br-sm' : 'bg-ai-bubble rounded-bl-sm'}`}>
        {message.content || (streaming ? '' : '…')}
        {streaming && <span className="text-accent animate-pulse">▍</span>}
      </div>
      {!isUser && message.structured?.correction && <CorrectionCard correction={message.structured.correction} />}
      {!isUser && message.structured?.vocabulary?.length ? <VocabChips vocabulary={message.structured.vocabulary} /> : null}
      <div className="text-[11px] text-fg-3 flex gap-2">
        {isUser && message.fromAsr && <span>🎙 语音输入</span>}
        {message.status === 'stopped' && <span>已停止</span>}
        {message.status === 'error' && <span className="text-bad">发送失败</span>}
      </div>
    </div>
  )
}
```

`components/MessageList.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '@shared/types'
import { MessageBubble } from './MessageBubble'

export function MessageList({ messages, note }: { messages: Message[]; note?: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const lastContent = messages.at(-1)?.content
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [messages.length, lastContent])
  return (
    <div ref={ref} className="flex-1 overflow-auto p-4 flex flex-col gap-3.5">
      {note && <div className="self-center text-xs text-fg-3 bg-surface-2 px-2.5 py-1 rounded-full">{note}</div>}
      {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
    </div>
  )
}
```

- [ ] **Step 4: `InputBar.tsx`**

```tsx
import { useState, type KeyboardEvent } from 'react'
import { canSend, isBusy, type UiState } from '../state/machine'

interface Props {
  ui: UiState
  onSend: (text: string) => void
  onStop: () => void
  onPickImage: () => void
}

export function InputBar({ ui, onSend, onStop, onPickImage }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const busy = isBusy(ui)
  const submit = (): void => {
    const t = text.trim()
    if (!t || !canSend(ui)) return
    onSend(t)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const btn = 'w-9 h-9 rounded-lg inline-flex items-center justify-center border border-line bg-surface text-fg-2 disabled:opacity-40'
  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5 flex items-end gap-2">
      <button className={btn} title="选择图片，识别为学习内容" onClick={onPickImage} disabled={busy}>🖼</button>
      <textarea
        id="chat-input"
        className="flex-1 min-w-0 resize-none h-10 max-h-30 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-2 focus:outline-accent"
        placeholder="输入英文，回车发送…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={ui === 'recording' || ui === 'transcribing'}
      />
      <button className={btn} title="语音输入在阶段 2 提供" disabled>🎤</button>
      {busy ? (
        <button className={`${btn} bg-bad-soft text-bad`} title="停止生成" onClick={onStop}>■</button>
      ) : (
        <button className={`${btn} bg-accent text-white border-transparent`} title="发送" onClick={submit} disabled={!canSend(ui) || !text.trim()}>➤</button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: `ConversationList.tsx` 与 `ChatPage.tsx`**

`components/ConversationList.tsx`：

```tsx
import type { Conversation } from '@shared/types'
import { MODE_LABEL } from '@shared/types'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationList({ conversations, currentId, onSelect, onNew }: Props): React.JSX.Element {
  return (
    <div className="w-[230px] shrink-0 border-r border-line flex flex-col min-h-0">
      <div className="flex items-center justify-between px-2.5 pt-10 pb-1.5">
        <h2 className="text-[13px] text-fg-2 font-semibold">会话</h2>
        <button className="text-xs px-2 py-0.5 rounded-md bg-accent text-white" onClick={onNew}>＋ 新建</button>
      </div>
      <ul className="overflow-auto flex-1 px-1.5 m-0 p-0 list-none">
        {conversations.map((c) => (
          <li
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`px-2 py-2 rounded-md cursor-pointer flex flex-col gap-0.5 ${c.id === currentId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
          >
            <span className="font-medium truncate">{c.title}</span>
            <span className="text-[11.5px] text-fg-3 flex gap-1.5 items-center">
              <span className="text-[11px] px-1.5 rounded-full bg-accent-soft text-accent">{MODE_LABEL[c.mode]}</span>
              {c.updatedAt.slice(5, 16).replace('T', ' ')}
            </span>
          </li>
        ))}
        {conversations.length === 0 && <li className="px-2 py-4 text-fg-3 text-xs">还没有会话，点"新建"开始</li>}
      </ul>
    </div>
  )
}
```

`components/ChatPage.tsx`：

```tsx
import { useState, type ClipboardEvent, type DragEvent } from 'react'
import { MODE_LABEL } from '@shared/types'
import { useChat } from '../store/ChatStore'
import { ConversationList } from './ConversationList'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { StatePill } from './StatePill'

const ERROR_TEXT: Record<string, string> = {
  not_logged_in: 'Claude Code 未登录或不可用，去设置页点"检测连接"。',
  binary_missing: '找不到 Claude 二进制，请重新安装依赖。',
  rate_limited: '请求被限流，稍后再试。',
  network: '网络异常，稍后再试。'
}

export function ChatPage({ onOpenLessonDialog }: { onOpenLessonDialog: (files?: File[]) => void }): React.JSX.Element {
  const chat = useChat()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [drag, setDrag] = useState(false)
  const err = chat.current ? chat.state.errors[chat.current.id] : undefined
  const retrying = chat.current ? chat.state.retrying[chat.current.id] : undefined

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDrag(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) onOpenLessonDialog(files)
  }
  const onPaste = (e: ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      onOpenLessonDialog(files)
    }
  }
  const onDelete = async (): Promise<void> => {
    if (!chat.current) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 2500)
      return
    }
    setConfirmDelete(false)
    await chat.deleteConversation(chat.current.id)
  }

  return (
    <>
      <ConversationList conversations={chat.state.conversations} currentId={chat.current?.id ?? null} onSelect={(id) => void chat.select(id)} onNew={() => void chat.createConversation({ mode: 'free' })} />
      <div
        className="flex-1 min-w-0 flex flex-col relative"
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false) }}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {drag && <div className="absolute inset-0 z-10 bg-accent-soft border-2 border-dashed border-accent flex items-center justify-center text-accent text-base">松开，识别为学习内容</div>}
        {chat.current ? (
          <>
            <div className="flex items-center gap-2.5 px-4 pt-10 pb-2.5 border-b border-line">
              <h2 className="text-sm font-semibold flex-1 truncate">{chat.current.title}</h2>
              <span className="text-[11px] px-1.5 rounded-full bg-accent-soft text-accent">{MODE_LABEL[chat.current.mode]}{chat.current.scenario ? ` · ${chat.current.scenario}` : ''}</span>
              <StatePill state={chat.ui} />
              <button className="text-xs px-2 py-0.5 rounded-md border border-line text-bad" onClick={() => void onDelete()}>{confirmDelete ? '确认删除？' : '删除'}</button>
            </div>
            {retrying !== undefined && <div className="px-4 py-1 text-xs text-warn bg-warn-soft">Claude 请求重试中（第 {retrying} 次）…</div>}
            {err && (
              <div className="px-4 py-1.5 text-xs text-bad bg-bad-soft flex items-center gap-2">
                <span className="flex-1">{ERROR_TEXT[err] ?? err}</span>
                <button className="underline" onClick={chat.clearError}>知道了</button>
              </div>
            )}
            <MessageList messages={chat.currentMessages} />
            <InputBar ui={chat.ui} onSend={(t) => void chat.sendMessage(t)} onStop={() => void chat.cancel()} onPickImage={() => onOpenLessonDialog()} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-fg-3">新建一个会话开始练习</div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 6: 手动验证**

Run: `npx vitest run && npm run typecheck && npm run dev:fake`

Expected：
1. 左栏"新建"后出现"自由聊天"会话，右侧开场白逐词出现（Fake 每词 40 ms），状态标签 `sending → streaming → idle`，结束后出现纠错卡（可展开）和生词条（可展开）。
2. 输入 `I goed to work` 回车：用户气泡出现在右侧，AI 回复流式出现；流式中发送键变成红色"■"，点击后回复停住、状态回 `idle`、气泡下方显示"已停止"。
3. 切换到另一个会话再切回，消息仍在；点"删除"两次后会话消失。
4. 把一张图片拖进聊天区会出现蓝色覆盖层，松开后暂时没有反应（Task 12 接上）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer
git commit -m "feat: 聊天页界面（会话列表、流式消息、纠错卡、生词、输入条）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 新建会话弹窗、课程识别弹窗、课程页

**Files:**
- Create: `src/renderer/src/lib/image.ts`、`src/renderer/src/components/Modal.tsx`、`NewConversationDialog.tsx`、`LessonDialog.tsx`、`LessonsPage.tsx`
- Modify: `src/shared/types.ts`（加 `SCENARIOS`）、`src/main/learning/prompts.ts`（改为从 shared 导入）、`src/renderer/src/App.tsx`、`src/renderer/src/components/ChatPage.tsx`（`onNew` 改为打开弹窗）

**Interfaces:**
- Consumes: Task 10 `useChat()`；`api.lessons.*`、`api.image.pick`；Task 2 schema 与类型。
- Produces:

```ts
export const SCENARIOS: readonly string[]                 // shared/types.ts
export async function fileToImageInput(file: File): Promise<ImageInput>        // 压缩到长边 ≤1600、JPEG、≤1.5MB
export async function rawToImageInput(raw: ImageInput): Promise<ImageInput>    // 主进程选的原图也走同一压缩
export function Modal(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }): JSX.Element
export function NewConversationDialog(props: { open: boolean; onClose: () => void; presetMode?: Mode; presetLessonId?: string }): JSX.Element
export function LessonDialog(props: { open: boolean; onClose: () => void; initialFiles?: File[]; pickFromDisk?: boolean }): JSX.Element
export function LessonsPage(props: { onNewFromText: () => void; onNewFromImage: () => void }): JSX.Element
```

- [ ] **Step 1: `SCENARIOS` 移到 shared**

`src/shared/types.ts` 末尾加：

```ts
export const SCENARIOS = ['机场', '出租车', '餐厅', '购物', '看病挂号', '工作会议'] as const
```

`src/main/learning/prompts.ts` 删掉本地的 `SCENARIOS` 定义，改为：

```ts
export { SCENARIOS } from '@shared/types'
```

Run: `npx vitest run src/main/learning` → PASS。

- [ ] **Step 2: `lib/image.ts`**

```ts
import type { ImageInput } from '@shared/types'

const MAX_EDGE = 1600
const MAX_BYTES = 1.5 * 1024 * 1024

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片无法解码'))
    img.src = src
  })
}

async function compress(img: HTMLImageElement, name?: string): Promise<ImageInput> {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const q of [0.85, 0.75, 0.65, 0.5, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', q)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (base64.length * 0.75 <= MAX_BYTES) return { mime: 'image/jpeg', base64, name }
  }
  throw new Error('图片压缩后仍然过大')
}

export async function fileToImageInput(file: File): Promise<ImageInput> {
  const url = URL.createObjectURL(file)
  try {
    return await compress(await loadImage(url), file.name)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function rawToImageInput(raw: ImageInput): Promise<ImageInput> {
  return compress(await loadImage(`data:${raw.mime};base64,${raw.base64}`), raw.name)
}
```

- [ ] **Step 3: `components/Modal.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react'

interface Props { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }

export function Modal({ open, onClose, title, children, footer }: Props): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-20 bg-black/35 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-line rounded-xl w-[560px] max-w-full max-h-[90vh] overflow-auto p-5 flex flex-col gap-3.5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `components/NewConversationDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Lesson, Mode } from '@shared/types'
import { MODE_LABEL, SCENARIOS } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'
import { Modal } from './Modal'

const MODES: Array<{ mode: Mode; hint: string; disabled?: boolean }> = [
  { mode: 'free', hint: '随便聊，AI 顺带纠错' },
  { mode: 'lesson', hint: '围绕一篇已保存的课程' },
  { mode: 'roleplay', hint: 'AI 扮演场景中的角色' },
  { mode: 'scenario', hint: '给你一个目标，完成为止' },
  { mode: 'targeted', hint: '按薄弱点和到期错句出题（阶段 3）', disabled: true }
]

interface Props { open: boolean; onClose: () => void; presetMode?: Mode; presetLessonId?: string }

export function NewConversationDialog({ open, onClose, presetMode, presetLessonId }: Props): React.JSX.Element {
  const chat = useChat()
  const [mode, setMode] = useState<Mode>('free')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [lessonId, setLessonId] = useState<string | undefined>()
  const [scenario, setScenario] = useState<string>(SCENARIOS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode(presetMode ?? 'free')
    setError(null)
    void api.lessons.list().then((ls) => {
      setLessons(ls)
      setLessonId(presetLessonId ?? ls[0]?.id)
    })
  }, [open, presetMode, presetLessonId])

  const needsLesson = mode === 'lesson'
  const needsScenario = mode === 'roleplay' || mode === 'scenario'
  const canStart = !busy && (!needsLesson || !!lessonId)

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await chat.createConversation({ mode, lessonId: needsLesson ? lessonId : undefined, scenario: needsScenario ? scenario : undefined })
      onClose()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const chip = (active: boolean): string => `px-2.5 py-1 rounded-full border text-[12.5px] ${active ? 'bg-accent text-white border-transparent' : 'border-line text-fg-2'}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建会话"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-fg-3">模式和课文在会话创建时固定，中途切换请新建会话</span>
          <button className="px-3 py-1.5 rounded-md border border-line" onClick={onClose}>取消</button>
          <button className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50" disabled={!canStart} onClick={() => void start()}>{busy ? '创建中…' : '开始'}</button>
        </>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {MODES.map((m) => (
          <button
            key={m.mode}
            disabled={m.disabled}
            onClick={() => setMode(m.mode)}
            className={`text-left px-3 py-2.5 rounded-lg border flex flex-col gap-0.5 disabled:opacity-40 ${mode === m.mode ? 'border-accent bg-accent-soft' : 'border-line'}`}
          >
            <b className="text-[13px]">{MODE_LABEL[m.mode]}</b>
            <span className="text-[11.5px] text-fg-2">{m.hint}</span>
          </button>
        ))}
      </div>
      {needsLesson && (
        <div className="flex flex-col gap-2">
          <span className="text-fg-3 text-xs">选择课程</span>
          {lessons.length === 0 ? (
            <span className="text-xs text-warn">还没有课程，先去"课程"页从图片或文本新建一篇</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {lessons.map((l) => <button key={l.id} className={chip(l.id === lessonId)} onClick={() => setLessonId(l.id)}>{l.title}</button>)}
            </div>
          )}
        </div>
      )}
      {needsScenario && (
        <div className="flex flex-col gap-2">
          <span className="text-fg-3 text-xs">选择场景</span>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((s) => <button key={s} className={chip(s === scenario)} onClick={() => setScenario(s)}>{s}</button>)}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-bad">{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 5: `components/LessonDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { ImageInput, LessonExtraction } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'
import { fileToImageInput, rawToImageInput } from '../lib/image'
import { Modal } from './Modal'

type Step = 'input' | 'extracting' | 'edit'
interface Props { open: boolean; onClose: () => void; initialFiles?: File[]; pickFromDisk?: boolean; onSaved?: () => void }

export function LessonDialog({ open, onClose, initialFiles, pickFromDisk, onSaved }: Props): React.JSX.Element {
  const chat = useChat()
  const [step, setStep] = useState<Step>('input')
  const [images, setImages] = useState<ImageInput[]>([])
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<LessonExtraction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep('input'); setImages([]); setText(''); setDraft(null); setError(null)
    const load = async (): Promise<void> => {
      try {
        if (initialFiles?.length) setImages(await Promise.all(initialFiles.slice(0, 4).map(fileToImageInput)))
        else if (pickFromDisk) {
          const raw = await api.image.pick()
          setImages(await Promise.all(raw.slice(0, 4).map(rawToImageInput)))
        }
      } catch (e) {
        setError(String((e as Error).message ?? e))
      }
    }
    void load()
  }, [open, initialFiles, pickFromDisk])

  const addFromDisk = async (): Promise<void> => {
    const raw = await api.image.pick()
    const more = await Promise.all(raw.map(rawToImageInput))
    setImages((prev) => [...prev, ...more].slice(0, 4))
  }

  const extract = async (): Promise<void> => {
    setStep('extracting'); setError(null)
    try {
      const r = await api.lessons.extract({ images: images.length ? images : undefined, text: text.trim() || undefined })
      setDraft(r); setStep('edit')
    } catch (e) {
      setError(String((e as Error).message ?? e)); setStep('input')
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const lesson = await api.lessons.save({ ...draft, source: images.length ? 'image' : 'text', images: images.length ? images : undefined })
      onSaved?.()
      await chat.createConversation({ mode: 'lesson', lessonId: lesson.id })
      onClose()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const canExtract = images.length > 0 || text.trim().length > 0
  const field = 'w-full rounded-md border border-line bg-surface px-2 py-1.5 selectable'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="识别为学习内容"
      footer={
        <>
          <button className="px-3 py-1.5 rounded-md border border-line" onClick={onClose}>取消</button>
          {step === 'input' && <button className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50" disabled={!canExtract} onClick={() => void extract()}>识别</button>}
          {step === 'edit' && <button className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50" disabled={busy || !draft?.title.trim() || !draft?.body.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存并开始课文问答'}</button>}
        </>
      }
    >
      <div className="flex gap-1.5 text-xs text-fg-3">
        <span className={step === 'input' ? 'text-accent font-semibold' : ''}>1 预览</span><span>›</span>
        <span className={step === 'extracting' ? 'text-accent font-semibold' : ''}>2 识别</span><span>›</span>
        <span className={step === 'edit' ? 'text-accent font-semibold' : ''}>3 确认</span>
      </div>
      {step === 'input' && (
        <>
          <div className="flex flex-wrap gap-2.5">
            {images.map((img, i) => (
              <div key={i} className="relative w-[130px] h-[96px] rounded-lg border border-line overflow-hidden bg-surface-2">
                <img src={`data:${img.mime};base64,${img.base64}`} className="w-full h-full object-cover" alt="" />
                <button className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-surface border border-line text-[11px] leading-none" onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {images.length < 4 && <button className="w-[130px] h-[96px] rounded-lg border border-dashed border-line text-fg-3 text-xs" onClick={() => void addFromDisk()}>＋ 选择图片</button>}
          </div>
          <div className="text-[12.5px] px-2.5 py-2 rounded-md bg-warn-soft text-warn">图片会发送给 Claude 进行识别。识别完成并确认后，之后的练习只使用文本，不再发送图片。</div>
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            或者直接粘贴文本（邮件、文档、课文）
            <textarea id="lesson-text" className={`${field} min-h-[70px]`} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴英文文本…" />
          </label>
        </>
      )}
      {step === 'extracting' && <p className="text-fg-2"><span className="inline-block w-3.5 h-3.5 mr-1.5 align-[-2px] rounded-full border-2 border-line border-t-accent animate-spin" />正在识别课文、标题和生词…</p>}
      {step === 'edit' && draft && (
        <>
          <label className="flex flex-col gap-1 text-xs text-fg-2">标题<input id="lesson-title" className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">正文（可修改）<textarea id="lesson-body" className={`${field} min-h-[140px] leading-relaxed`} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs text-fg-2">中文注释<textarea id="lesson-notes" className={`${field} min-h-[50px]`} value={draft.notesZh} onChange={(e) => setDraft({ ...draft, notesZh: e.target.value })} /></label>
          <div className="flex flex-col gap-1 text-xs text-fg-2">
            生词（点一下删除）
            <div className="flex flex-wrap gap-1.5">
              {draft.vocabulary.map((v) => (
                <button key={v.word} className="px-2.5 py-1 rounded-full bg-accent text-white text-[12.5px]" title={`${v.meaningZh} · ${v.example}`} onClick={() => setDraft({ ...draft, vocabulary: draft.vocabulary.filter((x) => x.word !== v.word) })}>{v.word} {v.meaningZh}</button>
              ))}
            </div>
          </div>
        </>
      )}
      {error && <div className="text-xs text-bad">{error}</div>}
    </Modal>
  )
}
```

- [ ] **Step 6: `components/LessonsPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Lesson } from '@shared/types'
import { api } from '../api'

interface Props { onNewFromText: () => void; onNewFromImage: () => void; onStartQa: (lessonId: string) => void; refreshKey: number }

export function LessonsPage({ onNewFromText, onNewFromImage, onStartQa, refreshKey }: Props): React.JSX.Element {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const reload = useCallback(async () => {
    const ls = await api.lessons.list()
    setLessons(ls)
    setCurrentId((id) => (id && ls.some((l) => l.id === id) ? id : (ls[0]?.id ?? null)))
  }, [])
  useEffect(() => { void reload() }, [reload, refreshKey])

  const current = lessons.find((l) => l.id === currentId) ?? null
  const remove = async (): Promise<void> => {
    if (!current) return
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 2500); return }
    setConfirmDelete(false)
    await api.lessons.delete(current.id)
    await reload()
  }
  const btn = 'text-xs px-2 py-1 rounded-md border border-line'

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold flex-1">课程</h2>
        <button className={btn} onClick={onNewFromText}>从文本新建</button>
        <button className={btn} onClick={onNewFromImage}>从图片识别</button>
      </div>
      <div className="flex-1 overflow-auto p-4 grid grid-cols-[260px_1fr] gap-4">
        <div className="flex flex-col gap-1">
          {lessons.map((l) => (
            <div key={l.id} onClick={() => setCurrentId(l.id)} className={`px-2.5 py-2 rounded-lg cursor-pointer flex flex-col gap-0.5 ${l.id === currentId ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
              <span className="font-medium truncate">{l.title}</span>
              <span className="text-[11.5px] text-fg-3">{l.source === 'image' ? '图片' : '文本'} · {l.createdAt.slice(0, 10)} · 生词 {l.vocabulary.length}</span>
            </div>
          ))}
          {lessons.length === 0 && <div className="text-xs text-fg-3 px-2 py-4">还没有课程</div>}
        </div>
        {current && (
          <div className="border border-line rounded-lg p-4 selectable">
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <h3 className="text-sm font-semibold flex-1 m-0">{current.title}</h3>
              <button className={`${btn} bg-accent text-white border-transparent`} onClick={() => onStartQa(current.id)}>开始课文问答</button>
              <button className={`${btn} text-bad`} onClick={() => void remove()}>{confirmDelete ? '确认删除？' : '删除'}</button>
            </div>
            <div className="whitespace-pre-wrap leading-relaxed text-sm">{current.body}</div>
            {current.notesZh && <p className="text-zh mt-3 mb-1.5">{current.notesZh}</p>}
            <div className="flex flex-wrap gap-1.5">
              {current.vocabulary.map((v) => <span key={v.word} className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs" title={`${v.meaningZh} · ${v.example}`}>{v.word}</span>)}
            </div>
            {current.assets.length > 0 && <p className="text-xs text-fg-3 mt-2.5">原图 {current.assets.length} 张已保存在本机</p>}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 把弹窗接进 `App.tsx` 与 `ChatPage.tsx`**

`App.tsx` 改为：

```tsx
import { useState } from 'react'
import type { Mode } from '@shared/types'
import { ChatProvider } from './store/ChatStore'
import { Sidebar, type Page } from './components/Sidebar'
import { ChatPage } from './components/ChatPage'
import { LessonsPage } from './components/LessonsPage'
import { NewConversationDialog } from './components/NewConversationDialog'
import { LessonDialog } from './components/LessonDialog'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('chat')
  const [newOpen, setNewOpen] = useState<{ mode?: Mode; lessonId?: string } | null>(null)
  const [lessonOpen, setLessonOpen] = useState<{ files?: File[]; pick?: boolean } | null>(null)
  const [lessonsKey, setLessonsKey] = useState(0)

  const openLessonDialog = (files?: File[]): void => setLessonOpen(files?.length ? { files } : { pick: true })

  return (
    <ChatProvider>
      <div className="h-full flex bg-surface text-fg">
        <Sidebar page={page} onChange={setPage} />
        <main className="flex-1 min-w-0 flex">
          {page === 'chat' && <ChatPage onOpenLessonDialog={openLessonDialog} onNew={() => setNewOpen({})} />}
          {page === 'lessons' && (
            <LessonsPage
              refreshKey={lessonsKey}
              onNewFromText={() => setLessonOpen({})}
              onNewFromImage={() => setLessonOpen({ pick: true })}
              onStartQa={(lessonId) => { setNewOpen({ mode: 'lesson', lessonId }); setPage('chat') }}
            />
          )}
          {page === 'settings' && <div className="p-6 text-fg-2">设置页在 Task 13 实现</div>}
        </main>
      </div>
      <NewConversationDialog open={newOpen !== null} onClose={() => setNewOpen(null)} presetMode={newOpen?.mode} presetLessonId={newOpen?.lessonId} />
      <LessonDialog
        open={lessonOpen !== null}
        onClose={() => setLessonOpen(null)}
        initialFiles={lessonOpen?.files}
        pickFromDisk={lessonOpen?.pick}
        onSaved={() => { setLessonsKey((k) => k + 1); setPage('chat') }}
      />
    </ChatProvider>
  )
}
```

`ChatPage.tsx`：props 加 `onNew: () => void`，`ConversationList` 的 `onNew` 改为传入的 `onNew`。

- [ ] **Step 8: 手动验证**

Run: `npm run typecheck && npm run dev:fake`

Expected：
1. "新建"弹出模式选择；选"角色扮演"出现场景；选"餐厅"开始，会话标题为"餐厅 · 角色扮演"。
2. 拖一张图片到聊天区：弹出识别对话框，缩略图可见（已压成 JPEG），点"识别"后 Fake 返回默认课文，第三步可编辑标题正文，"保存并开始课文问答"后自动新建一个课文问答会话。注意 Fake 的 `analyzeResult` 默认为空会报"fake analyzeResult does not match schema"，为了演示把 `src/main/index.ts` 里 Fake 的构造改为 `new FakeAIProvider({ deltaDelayMs: 40, analyzeResult: { title: 'Lesson 5: Nice to meet you', body: 'Good morning.\nGood morning, Mr. Blake.', vocabulary: [{ word: 'morning', meaningZh: '早上', example: 'Good morning.' }], notesZh: '问候与介绍。' } })`。
3. 课程页列出刚保存的课程，详情里有正文、注释、生词；"开始课文问答"跳到聊天页并预选课程；删除两次确认后消失。
4. 在课程页"从文本新建"，粘贴一段英文，识别、保存同样成功，`source` 为文本、无原图。

- [ ] **Step 9: 提交**

```bash
git add src/shared src/main/learning src/main/index.ts src/renderer
git commit -m "feat: 新建会话弹窗、课程识别弹窗与课程页

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: 设置页与真实 Claude 联调（阶段 1 验收）

**Files:**
- Create: `src/renderer/src/components/SettingsPage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `docs/superpowers/specs/2026-10-12-speakmate-design.md` 第 2 节（记录联调结论）

**Interfaces:**
- Consumes: Task 10 `useChat().settings / patchSettings`、`api.ai.check`。
- Produces: `SettingsPage(): JSX.Element`。

- [ ] **Step 1: `components/SettingsPage.tsx`**

```tsx
import { useState } from 'react'
import type { AICheckResult } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button className="inline-flex items-center gap-2" onClick={() => onChange(!on)} aria-pressed={on}>
      <span className={`w-[34px] h-5 rounded-full relative transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-0.5'}`} />
      </span>
      <span>{label}{on ? '开' : '关'}</span>
    </button>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { settings, patchSettings } = useChat()
  const [check, setCheck] = useState<AICheckResult | 'checking' | null>(null)
  const runCheck = async (): Promise<void> => {
    setCheck('checking')
    setCheck(await api.ai.check())
  }
  const card = 'border border-line rounded-lg px-4 py-3.5 flex flex-col gap-2'
  const kv = 'grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 items-center'
  const k = 'text-fg-2 text-[12.5px]'
  const select = 'rounded-md border border-line bg-surface px-2 py-1'

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="px-4 pt-10 pb-3 border-b border-line"><h2 className="text-[15px] font-semibold">设置</h2></div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3.5 max-w-[720px]">
        <section className={card}>
          <h3 className="text-sm font-semibold">Claude 连接</h3>
          <div className={kv}>
            <span className={k}>模型</span>
            <select id="model" className={select} value={settings.model} onChange={(e) => void patchSettings({ model: e.target.value })}>
              <option value="">账号默认</option>
              <option value="sonnet">sonnet</option>
              <option value="opus">opus</option>
            </select>
            <span className={k}></span>
            <span className="flex items-center gap-2">
              <button className="text-xs px-2 py-1 rounded-md border border-line" onClick={() => void runCheck()} disabled={check === 'checking'}>检测连接</button>
              {check === 'checking' && <span className="text-fg-3 text-xs">检测中…</span>}
              {check && check !== 'checking' && (
                <span className={`text-xs ${check.ok ? 'text-good' : 'text-bad'}`}>
                  {check.ok ? `连接正常 · ${check.model ?? ''} · ${check.durationMs ?? 0} ms` : `失败：${check.message}`}
                </span>
              )}
            </span>
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">学习</h3>
          <div className={kv}>
            <span className={k}>难度</span>
            <select id="difficulty" className={select} value={settings.difficulty} onChange={(e) => void patchSettings({ difficulty: e.target.value as typeof settings.difficulty })}>
              <option value="beginner">初级</option>
              <option value="intermediate">中级</option>
              <option value="advanced">高级</option>
            </select>
            <span className={k}>中文解释</span>
            <Toggle on={settings.chineseExplanations} onChange={(v) => void patchSettings({ chineseExplanations: v })} label="" />
          </div>
          <p className="text-xs text-fg-3 m-0">难度和中文解释对新建的会话生效。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">语音</h3>
          <p className="text-xs text-fg-3 m-0">语音识别与朗读在阶段 2 提供。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">数据与隐私</h3>
          <p className="text-[12.5px] text-fg-2 leading-relaxed m-0">
            你输入的文字、确认后的课文文本会发送给 Claude。课文图片只在你点击"识别"时发送一次，之后只使用文本。会话、课程只保存在本机数据库（应用数据目录下的 speakmate.db）。
          </p>
        </section>
      </div>
    </div>
  )
}
```

`App.tsx` 里把 `settings` 分支换成 `<SettingsPage />`（补 import）。

- [ ] **Step 2: 真实 Claude 联调**

Run: `npm run typecheck && npm run dev`（不带 Fake）。按下列顺序操作并记录结果：

1. 设置页"检测连接"：应显示"连接正常 · <模型名> · 约 1～3 秒"。
2. 新建"自由聊天"：开场白流式出现（首个字约 2～3 秒），结束后无纠错卡（开场轮要求不纠错）。
3. 输入 `I goed to the airport yesterday and buyed a ticket.`：回复流式出现，结束后纠错卡显示 `goed → went` 类纠错和中文解释，有 1～3 个生词。
4. 流式中点"■"：回复停住、显示"已停止"；再发一句能正常继续（说明 `resume` 在中断后仍可用）。
5. 把 `/private/tmp/claude-501/.../scratchpad/sdkprobe/img/l5.txt.png`（或任意课文截图）拖进聊天区，识别后确认保存；新会话的开场白应提到课文内容（如 Mr. Blake / Sophie）。
6. 退出应用再 `npm run dev`：左栏会话、课程页课程都还在，消息完整。
7. 在终端 `claude auth status` 的登录状态不受影响；`~/Library/Application Support/speakmate/claude-sessions/` 下 `~/.claude/projects/` 对应目录出现会话 jsonl。

- [ ] **Step 3: 把结论写回 spec 第 2 节**

在 `docs/superpowers/specs/2026-10-12-speakmate-design.md` 第 2 节追加一行，格式：

```md
- 2026-MM-DD 阶段 1 联调（Electron 主进程 + Agent SDK）：检测连接 <N> ms；开场白首字 <N> s；纠错卡正常；停止后 resume 正常；课文图片识别正常；重启后数据保留。问题：<无 / 列出>。
```

- [ ] **Step 4: 提交**

```bash
git add src/renderer docs/superpowers/specs
git commit -m "feat: 设置页；记录阶段 1 真实联调结论

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 阶段 0 剩余验证：whisper.cpp、say、Finder 启动复用登录

**Files:**
- Create: `scripts/probe-whisper.sh`
- Modify: `electron-builder.yml`
- Modify: `docs/superpowers/specs/2026-10-12-speakmate-design.md` 第 2 节

**Interfaces:**
- Produces: 验证过的 `whisper-cli` 调用参数与 JSON 输出样例（阶段 2 计划据此写解析器）；可从 Finder 启动并复用登录的 `.app`。

- [ ] **Step 1: 写 `scripts/probe-whisper.sh`**

```bash
#!/usr/bin/env bash
# 阶段 0：验证 whisper.cpp 命令行、模型下载、say 生成的 wav 能被识别。
set -euo pipefail

MODELS_DIR="$HOME/Library/Application Support/speakmate/models"
MODEL="$MODELS_DIR/ggml-small.en.bin"
WORK="$(mktemp -d)"

if ! command -v whisper-cli >/dev/null; then
  echo ">> 安装 whisper.cpp"
  brew install whisper.cpp
fi
echo ">> whisper-cli: $(command -v whisper-cli)"
whisper-cli --help 2>&1 | grep -E -- '-(oj|ojf|of|np|nt|l) ' || true

mkdir -p "$MODELS_DIR"
if [ ! -f "$MODEL" ]; then
  echo ">> 下载 ggml-small.en.bin（约 466 MB）"
  curl -L --progress-bar -o "$MODEL" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
fi
ls -la "$MODEL"

echo ">> 用 say 合成一段英语并转成 16 kHz 单声道 wav"
say -v Samantha -o "$WORK/t.aiff" "I went to the airport yesterday and bought a ticket to Shanghai."
afconvert -f WAVE -d LEI16@16000 -c 1 "$WORK/t.aiff" "$WORK/t.wav"
afinfo "$WORK/t.wav" | grep -E 'Data format|estimated duration'

echo ">> 识别（耗时见下）"
START=$(date +%s.%N)
whisper-cli -m "$MODEL" -f "$WORK/t.wav" -l en -ojf -of "$WORK/t" -np
END=$(date +%s.%N)
echo ">> 耗时 $(echo "$END - $START" | bc) 秒"
echo ">> JSON 输出（前 60 行）"
head -60 "$WORK/t.json"
echo ">> 文本："
python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(''.join(s['text'] for s in d['transcription']).strip()); print('segments:', len(d['transcription'])); t=[tok for s in d['transcription'] for tok in s.get('tokens',[])]; print('tokens with p:', len(t), 'mean p:', round(sum(x['p'] for x in t)/len(t),3) if t else None)" "$WORK/t.json"
echo ">> 临时目录 $WORK（看完可删）"
```

```bash
chmod +x scripts/probe-whisper.sh
./scripts/probe-whisper.sh
```

Expected：识别文本与合成句子一致（标点可能不同）；耗时在 Apple Silicon 上 1～3 秒；JSON 里有 `transcription[].text`、`offsets.from/to`、`tokens[].p`。若 `-ojf` 不被识别，改用 `-oj` 并记录"没有 token 概率，置信度改用固定值"。把实际可用的参数和 JSON 字段名记进 spec。

- [ ] **Step 2: electron-builder 配置**

把 `electron-builder.yml` 改为：

```yaml
appId: com.speakmate.app
productName: SpeakMate
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!docs/*'
  - '!scripts/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!vitest.config.ts'
  - '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}'
  - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
  - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
asarUnpack:
  - resources/**
  - node_modules/@anthropic-ai/claude-agent-sdk/**
  - node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/**
mac:
  target:
    - target: dmg
      arch: [arm64]
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    - NSMicrophoneUsageDescription: SpeakMate 需要使用麦克风录制你的英语口语，录音只在本机识别。
  notarize: false
dmg:
  artifactName: ${name}-${version}.${ext}
npmRebuild: false
```

`build/entitlements.mac.plist` 里确认包含：

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
```

- [ ] **Step 3: 打一个未打包目录版并从 Finder 启动**

```bash
npm run build:unpack
ls dist/mac-arm64/
open dist/mac-arm64/
```

在 Finder 里双击 `SpeakMate.app`（不是从终端 `open` 这个 .app，Finder 双击才是最简环境）。打开设置页点"检测连接"。

Expected：显示"连接正常"。若失败，看 `~/Library/Logs/SpeakMate/`（没有就在 `src/main/index.ts` 的 `check` 失败分支加 `console.error`，用 `open -a Console` 看）。常见原因与处理：
- 报 `Native CLI binary ... not found`：`asarUnpack` 没生效，确认 yml 的路径与 `node_modules` 实际目录一致，并检查 `dist/mac-arm64/SpeakMate.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` 有可执行权限。
- 报未登录：Finder 环境的 `HOME` 正常但 Keychain 读取被拒，检查是不是 `CLAUDE_CONFIG_DIR` 在 shell 里被设置过而 Finder 环境没有；`cleanEnv` 不应删除 `HOME`。

- [ ] **Step 4: 写回 spec 第 2 节**

追加：

```md
- 2026-MM-DD whisper.cpp <版本>：`whisper-cli -m <model> -f <wav> -l en -ojf -of <out> -np` 可用；JSON 字段 transcription[].text / offsets / tokens[].p；合成 wav 识别耗时 <N> s，文本正确。
- 2026-MM-DD Finder 双击 `build:unpack` 产物：检测连接 <通过 / 失败原因与修复>。
```

- [ ] **Step 5: 提交**

```bash
git add scripts electron-builder.yml build docs/superpowers/specs
git commit -m "chore: whisper.cpp 验证脚本、electron-builder 配置与 Finder 启动验证结论

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完成标准（M1）

对照 spec 第 1.1 节：第 1、2、3、4（文字部分）、7 条在本计划内完成；第 4 条的语音、第 5 条的朗读、第 6 条的错句本 / 生词本 / 画像分别属于阶段 2 和阶段 3 的计划。
