# SpeakMate（my-tutor）设计 spec

- 日期：2026-10-12
- 状态：设计已确认，待出实施计划
- 来源：用户需求文档《SpeakMate_Electron_AI_英语陪练实施方案 v1.0》+ 本次 brainstorming 的决策
- 目标平台：macOS Apple Silicon，个人使用

## 1. 目标与范围

做一个 Mac 桌面 App，用 AI 陪练日常英语和工作英语。把成熟能力（Claude、本地 ASR、系统 TTS、SQLite）整合成一个可持续使用的学习闭环：

```
文字 / 课文图片 输入 → AI 对话（纠错 + 生词）→ 本地朗读 → 本地记录 → 学习画像 → 针对性练习
```

### 1.1 第一版完成标准

1. 打开应用，新建一个英语练习会话（五种模式之一）。
2. 输入文字，或粘贴 / 拖拽 / 选择一张英语课文图片，识别成课程并围绕它持续对话。
3. 点麦克风说英语，本地识别成文字，可修改后发送。
4. 每轮收到简单自然的英文回复、中文纠错和 1～3 个重点词汇。
5. AI 回复可用本地 TTS 朗读，可停止。
6. 错句、生词、会话小结自动落库；学习分析页能看到水平、薄弱点、建议，并能一键开始针对性练习。
7. 关闭再打开，课程、会话、学习记录仍在。

### 1.2 与原需求文档的差异（本次决策）

| 项目       | 原文档                               | 本 spec                                                                  |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------ |
| AI 接入    | Claude 官方 API + API Key + Keychain | 通过 Agent SDK 驱动本机已登录的 Claude Code，无 API Key，无 Keychain     |
| 本地 ASR   | sherpa-onnx / whisper.cpp 待评估     | whisper.cpp 命令行工具，子进程调用                                       |
| 学习模式   | 6 个                                 | 5 个：自由聊天、课文问答、角色扮演、场景任务、针对性练习；跟读与复述延后 |
| 对话上下文 | 应用自己做"最近 N 轮 + 摘要"         | 交给 Claude Code 会话（resume），应用不拼历史                            |
| 图片消息   | 可拖进聊天窗口                       | 聊天里不出现图片消息，所有图片统一走"识别为学习内容"                     |
| 新增       | 无                                   | 学习画像 + 针对性练习 + 会话小结 + 文本粘贴成课程                        |
| 数据库时机 | 阶段 3                               | 基础表提前到阶段 1                                                       |

### 1.3 非目标（第一版不做）

- 训练或微调模型；发音评分；实时全双工语音；跟读模式；课文复述模式。
- 多用户、云同步、分发给他人。若将来分发，必须改为用户自己的 API Key，不能携带或中转个人登录。
- 扒 Claude 网页版 DOM / Cookie。
- 把语音模型打进安装包。
- Playwright 端到端测试；macOS 公证。

## 2. 关键事实（已在目标机器上核实）

- 机器：Apple Silicon，macOS 27，Node 24，npm 11，无 pnpm。
- `claude` 2.1.296 已安装并以订阅账号登录。
- 裸调 `claude -p` 每次约 50,000 输入 token（带 Claude Code 默认系统提示、工具说明、全局 CLAUDE.md）；改为自定义系统提示 + 不加载设置 + 禁用工具后约 600 token。**所有调用必须用后一种配置。**
- `--json-schema` / SDK `outputFormat` 结构化输出可用，结果在 `structured_output`；用 TutorResponse schema 实测纠错和中文解释正常。
- `--session-id <uuid>` 可自定会话 id，`--resume` 跨进程可续；系统提示在会话第一轮固化。
- 图片输入：SDK 流式输入模式（prompt 为 AsyncIterable）支持 base64 image 内容块，已实测；字符串 prompt 不支持图片。
- 取消：SDK `abortController`。
- 政策：官方禁止的是向第三方用户提供 claude.ai 登录或代用户走订阅额度；个人驱动未修改的官方二进制不在列。Fable 模型可能额外计费，不默认选。
- whisper.cpp 未安装，Homebrew 有 1.9.5（formula 名 `whisper.cpp`，命令 `whisper-cli`）。
- `say` 可用，英语音色有 Samantha（美）、Daniel（英）。
- Agent SDK 0.3.296（内置 CLI 2.1.296，与本机一致）在 Node 下实测：`tools: []` + `permissionMode: dontAsk` + `outputFormat` 正常；**模型先流式输出正文（9 个 text_delta，首个约 2.6 s），再调用 StructuredOutput**，`structured_output` 在 result 里，`result` 字段是同一份 JSON 字符串；`sessionId` 自定 UUID + `resume` 续接正常（约 3 s，命中缓存 1272 token）；base64 PNG 图片块经流式输入送达并被正确识读；init 消息里订阅登录的 `apiKeySource` 为 `none`，不能用它判断是否登录。SDK 提供 `deleteSession(id, { dir })`，删会话用它。
- `node:sqlite`（`DatabaseSync`）在 Electron 39 的 Node 22 里可用，不需要 better-sqlite3。
- 2026-10-12 阶段 1 联调（Electron 主进程 + Agent SDK）：检测连接 4948 ms；开场白首字 2.2 s；纠错卡正常；停止后 resume 正常；课文图片识别正常；重启后数据保留。问题：① 检测连接 4948 ms（模型 claude-fable-5-1，只测一次），高于预期的 1～3 s；② 长回复的 text_delta 集中在末尾到达（伦敦长故事首个 delta 在 20.0 s，0.13 s 内到齐 84 个后即 done），长回复基本看不到流式；③ 点停止后约 2 s 内仍有 delta 到达并写进消息；④ 停止恰好落在完成瞬间时，done 之后又到了 aborted，ChatService 把已完成的消息改写成 stopped 并清空 structured（`src/main/chat/service.ts` error 分支），当时界面显示完成 + 生词，重启后变成「已停止」且没有生词。
- 2026-10-12 whisper.cpp 1.9.5：`whisper-cli -m ggml-small.en.bin -f t.wav -l en -ojf -of t -np` 可用（`-of` 不带扩展名，自动写 `t.json`；`-np` 下 stdout 仍有输出，只解析 JSON 文件）；JSON 字段 transcription[].text / offsets / tokens[].p；合成 wav（`say` 3.4 s）识别耗时冷启动 7.46 s、热运行 0.32 s，文本正确。tokens 含 `[_BEG_]`、`[_TT_…]` 等特殊 token，算置信度时需过滤 `[_` 开头的。
- 2026-10-12 Finder 双击 `build:unpack` 产物：检测连接首次失败 `spawn ENOTDIR`——SDK 用 `require.resolve` 找到的 CLI 在 `app.asar/` 内，spawn 无法执行；修复：打包后传 `pathToClaudeCodeExecutable` 指向 `app.asar.unpacked/`（`src/main/index.ts` `packagedCliPath`）。修复后通过：连接正常 · claude-fable-5-1 · 2856 ms（HOME 正常，未设 `CLAUDE_CONFIG_DIR`，复用 Claude Code 登录）。启动方式为 AppleScript 让 Finder 打开 .app（父进程 launchd，PATH=/usr/bin:/bin:/usr/sbin:/sbin），非真人双击。
- 2026-10-13 阶段 2 验收（语音为 `say` 合成 WAV 经运行时覆盖 `getUserMedia` 注入，非真人说话；Cmd+Q 用 AppleScript quit 事件代替按键）：识别耗时 0.51 s（5.3 秒录音；60 秒录音 1.7 s）；置信度 0.84（绿色）；纠错卡正常；自动朗读 / 停止（say 0.1 s 内退出）/ 录音打断朗读正常；60 s 自动结束正常（60.9 s 自动停止并识别）；权限拒绝引导未验证（需人工在系统设置撤销权限；"打开系统设置"深链单独验证能打开「麦克风」页）；麦克风断开为模拟（派发 track `ended`）：横幅正常，已录部分照常识别进入 awaiting_confirmation 而非回 idle；模型缺失 / whisper-cli 路径无效提示正常（需重新进入聊天页才刷新）；打包后麦克风闭环通过（Finder 式最小 PATH 下找到 whisper-cli，录音 → 识别 → 发送 → 自动朗读正常），权限弹框未亲眼确认；修复 `electron-builder.yml` 的 `extendInfo` 写成列表导致自定义麦克风文案未生效（Info.plist 顶层仍是 Electron 默认英文），改为映射后生效；Cmd+Q 无残留 say 进程（开发态与打包态）。问题：① 上述 `extendInfo`（已修复）；② 语音就绪状态只在 `ChatPage` 挂载时查一次，聊天页内改名模型后麦克风仍可点，录完才报"模型未下载"；③ 错误横幅在之后成功录音/识别后仍保留，需手点"知道了"；④ 点麦克风到进入录音 0.02～4.4 s 不等，打包态实测已授权时 `requestMic` 0.37～3.2 s、首次真实 `getUserMedia` 2.9 s；⑤ whisper 会把 "goed / buyed" 识别成 "got / bought"，学习者错误可能被识别"纠正"掉；⑥ 用 `dev:fake` 建的会话在真实 provider 下续聊失败，只显示"请求失败，请稍后再试。"；⑦ 打包产物为 ad-hoc linker-signed，`codesign -d --entitlements -` 无输出（未签名不开 hardened runtime，不影响麦克风）。

## 3. 架构

### 3.1 工程

- `electron-vite`（React + TypeScript 模板），npm。
- Tailwind CSS，不用 shadcn。
- zod：IPC 入参校验 + AI 结构化输出校验，schema 在 `src/shared` 共用。
- 数据库用 Node 内置的 `node:sqlite`（`DatabaseSync`），不用 better-sqlite3：Electron 39 自带的 Node 22 已包含该模块（已实测），省掉原生模块重编译和 asar 解包。
- `@anthropic-ai/claude-agent-sdk` 固定 0.3.296（自带 CLI 二进制，平台包 `@anthropic-ai/claude-agent-sdk-darwin-arm64`）。
- zod 4：`z.toJSONSchema(schema, { target: "draft-7" })` 直接产出结构化输出用的 schema。
- Vitest。打包 electron-builder。

目录：

```
my-tutor/
  src/main/
    index.ts            窗口、生命周期、安全配置
    ipc/                chat.ts / lesson.ts / voice.ts / learning.ts / settings.ts，每个命令一个 handler，入参先过 zod
    ai/                 AIProvider 接口、ClaudeCliProvider、FakeAIProvider（测试）
    asr/                SpeechRecognitionService 接口、WhisperCliService、FakeASR
    tts/                TTSService 接口、MacSayService、FakeTTS
    db/                 连接、迁移（migrations/001.sql ...）、各表读写函数
    learning/           提示词拼装、会话小结、画像分析、复习间隔、针对性练习选材
    prompts/            base-tutor.md free-chat.md lesson-qa.md role-play.md scenario-task.md
                        targeted-practice.md extract-lesson.md summarize-session.md analyze-learner.md
  src/preload/index.ts  contextBridge 暴露 window.speakmate
  src/renderer/         React 页面、状态机、音频采集
  src/shared/           IPC 类型、zod schema、TutorResponse / Lesson / LearnerProfile 等类型
  docs/superpowers/specs/
```

### 3.2 进程边界与安全

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，严格 CSP，`will-navigate` / `setWindowOpenHandler` 拦截所有导航，外链用 `shell.openExternal`。
- preload 只暴露具体方法和一个 `onChatEvent(cb)` 订阅，不暴露 `ipcRenderer`。
- 渲染进程不接触文件路径、数据库、子进程。图片以 base64 + MIME + 尺寸传给主进程；音频以 ArrayBuffer 传。
- 请求-响应走 `ipcMain.handle`；AI 流式片段走主进程→渲染进程的单向事件通道，事件带 `conversationId`。
- 所有 IPC 入参 zod 校验，含大小上限（图片 ≤ 1.5 MB、≤ 4 张；音频 ≤ 60 秒）。

### 3.3 三个能力接口

```ts
interface AIProvider {
  chat(req: ChatRequest): AsyncIterable<ChatEvent> // 有会话，流式
  analyze<T>(req: AnalyzeRequest<T>): Promise<T> // 一次性、不留会话、结构化
}
interface ChatRequest {
  conversationId: string // 即 Claude 会话 UUID
  firstTurn: boolean // true 时带 systemPrompt + sessionId；false 时 resume
  systemPrompt?: string
  text: string
  signal: AbortSignal
}
type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; structured?: TutorResponse; rawText: string }
  | { type: 'retrying'; attempt: number }
  | { type: 'error'; kind: AIErrorKind; message: string }
type AIErrorKind =
  'not_logged_in' | 'binary_missing' | 'network' | 'rate_limited' | 'aborted' | 'unknown'

interface AnalyzeRequest<T> {
  systemPrompt: string
  text: string
  images?: Array<{ mime: string; base64: string }>
  schema: ZodSchema<T>
  signal?: AbortSignal
}

interface SpeechRecognitionService {
  isReady(): Promise<{ binary: boolean; model: boolean }>
  transcribe(wav: Buffer, signal: AbortSignal): Promise<ASRResult>
}
interface ASRResult {
  text: string
  confidence: number
  segments: Array<{ text: string; startMs: number; endMs: number }>
}

interface TTSService {
  speak(text: string, opts: { voice: string; rate: number }): Promise<void> // resolve 于播放结束或被 stop
  stop(): Promise<void>
  listVoices(): Promise<Array<{ id: string; label: string; lang: string }>>
}
```

UI 和学习逻辑只依赖接口；每个接口有一个 Fake 实现供测试和 UI 开发。

## 4. AI 层：ClaudeCliProvider

### 4.1 固定调用配置

每次 `query()` 必带：

- `systemPrompt`: 自定义字符串（不用 preset）。
- `settingSources: []`。
- `tools: []`；`permissionMode: "dontAsk"`。**不要传 `disallowedTools: ["*"]`**：它会把结构化输出用的内部 StructuredOutput 工具一起禁掉，导致 `error_max_turns`（已实测）。
- `outputFormat: { type: "json_schema", schema }`（schema 由 zod 转 draft-07）。
- `includePartialMessages: true`。
- `abortController`。
- `env: { ...process.env }`，且启动时若存在 `ANTHROPIC_API_KEY` 等会覆盖订阅登录的变量则从子进程 env 中删除。
- `cwd`: `userData/claude-sessions/`（会话记录文件落在固定项目目录）。
- `model`: 来自设置，默认不传（用账号默认）。
- `maxTurns: 3`（结构化输出本身占一个工具轮）。
- prompt 以 AsyncIterable 形式传（一条 user 消息，含 text 和可选 image 块）。

### 4.2 会话

- 新建会话时生成 UUID，作为 `conversations.id` 和 Claude `sessionId`。
- 第一轮：`sessionId` + 完整系统提示。后续：`resume: id`，不传系统提示。
- 系统提示 = `base-tutor.md` + 模式提示词 + 学习难度 + 学习者画像摘要（若有）+ 模式所需上下文（课文正文 / 场景 / 针对性练习选材）。因系统提示在第一轮固化，模式与课程绑定在会话上，换模式即新建会话。
- 删除会话时调用 SDK 的 `deleteSession(id, { dir: cwd })`（best-effort，失败不报错）。

### 4.3 结构化输出

每轮 chat 的 schema：

```ts
TutorResponse = {
  reply: string;                       // 给学生的英文回复（含一个后续问题）
  correction?: { original: string; improved: string; explanationZh: string;
                 category: "grammar" | "word_choice" | "naturalness" | "other";
                 uncertain?: boolean }; // 可能是 ASR 误识别而非语言错误
  vocabulary?: Array<{ word: string; meaningZh: string; example: string }>;  // ≤ 3
  nextAction?: string;
  taskCompleted?: boolean;             // 仅场景任务模式
}
```

- 系统提示要求模型先以普通文本写出 reply（流式显示），最后再填结构化字段。此行为在阶段 0 验证；若不成立，退回"不流式、等完整结果再显示"。
- 结果无 `structured_output` 或 zod 校验失败：用 `rawText` 作为回复展示，不显示纠错卡，不写错句和生词，会话继续，记一条 warn 日志。
- `correction.uncertain` 为 true 时纠错卡显示"可能是识别错误"，不计入薄弱点统计。

### 4.4 一次性调用（analyze）

- `persistSession: false`，其余配置同 4.1。
- 用途：课文识别（`extract-lesson.md`，输入图片或文本，输出 `{ title, body, vocabulary[], notesZh }`）；会话小结（`summarize-session.md`）；画像分析（`analyze-learner.md`）。
- 图片：渲染进程压缩到长边 ≤ 1600 px、JPEG、≤ 1.5 MB，最多 4 张；上传前 UI 提示"图片会发送给 Claude"。

### 4.5 错误与检测

- 错误分类见 `AIErrorKind`。判断依据：结果 `subtype` 非 success 时 `errors[]` 文本含 login / auth（未登录）、SDK 抛出的二进制缺失错误、`system` 消息 `subtype: api_retry`（限流 / 网络，UI 显示"重试中"）、`AbortError`。
- 设置页"检测 Claude 连接"：跑一次最小 `analyze`（约 600 token），显示登录方式、模型、耗时。
- 启动时不发请求；二进制是否可用由设置页检测连接验证（阶段 4 打包验收再补启动检查）。

## 5. 语音层

### 5.1 录音（渲染进程）

- `getUserMedia({ audio: true })`，AudioWorklet 收 Float32 PCM。
- 结束后 `OfflineAudioContext` 重采样到 16 kHz 单声道，编 16 位 PCM WAV，ArrayBuffer 经 IPC 送主进程。
- 上限 60 秒，到时自动结束。
- 发送前计算 RMS，整段近静音直接提示"没听到声音"，不调识别。
- 首次录音前主进程 `systemPreferences.askForMediaAccess("microphone")`；被拒时提供按钮打开 `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`。
- 设备拔出 / 流中断：捕获 track `ended`，回 idle 并提示。

### 5.2 识别（WhisperCliService）

- WAV 写入 `userData/tmp/<uuid>.wav`，spawn `whisper-cli -m <model> -f <wav> -l en -oj -of <out> -np`，读 `<out>.json` 取 text 与 segments；置信度 = token 概率均值，只用于 UI 提示"识别不确定"。
- 完成或失败后立即删除 WAV 与 JSON；默认不保留录音。
- 超时 60 秒杀进程；`signal` 取消杀进程；同一时刻只允许一个识别任务（第二个直接拒绝）。
- 路径设置：`whisperBinaryPath` 默认 `/opt/homebrew/bin/whisper-cli`；`whisperModelPath` 默认 `userData/models/ggml-small.en.bin`。
- 设置页显示二进制与模型状态；模型下载自 whisper.cpp 官方 Hugging Face 仓库（`ggml-small.en.bin`），带进度与删除；二进制缺失时提示 `brew install whisper.cpp`。

### 5.3 朗读（MacSayService）

- spawn `say -v <voice> -r <rate>`，文本经 stdin 写入，不经命令行参数。
- 一次一个进程；`stop()` 杀进程；新 `speak()` 先 `stop()`；开始录音、发送新消息、切换会话时自动 `stop()`；窗口关闭时释放。
- `listVoices()` 解析 `say -v ?` 中 `en_*` 行；默认 Samantha，语速默认 175。
- 设置"自动朗读 AI 回复"：开启时每轮 `done` 后只朗读 `reply`。
- TTS 失败只提示，不影响聊天。

## 6. 数据层

- `node:sqlite` 的 `DatabaseSync`，`userData/speakmate.db`，WAL；`PRAGMA user_version` 编号迁移，`migrations/NNN.sql` 只追加。
- 查询同步，直接在主进程执行。

表：

| 表                  | 字段要点                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`     | id(uuid, 同 Claude 会话)、title、mode、lesson_id?、scenario?、turn_count、created_at、updated_at、ended_at?                                         |
| `messages`          | id、conversation_id、role(user/assistant)、content、structured_json?、status(sent/streaming/done/error)、created_at                                 |
| `lessons`           | id、title、body、source(image/text)、notes_zh、created_at                                                                                           |
| `lesson_assets`     | id、lesson_id、path(`userData/lessons/<id>/<n>.jpg`)、mime、size                                                                                    |
| `mistakes`          | id、conversation_id?、message_id?、original、improved、explanation_zh、category、review_count、next_review_at、status(pending/mastered)、created_at |
| `vocabulary`        | id、word(unique)、meaning_zh、example、source(conversation/lesson)、source_id?、seen_count、familiarity(0-5)、next_review_at、created_at            |
| `practice_sessions` | conversation_id(pk)、mode、started_at、ended_at、turns、summary_json?                                                                               |
| `learner_profile`   | id=1、level、weaknesses_json、progress_json、suggestions_json、summary_zh、updated_at                                                               |
| `settings`          | key、value                                                                                                                                          |

规则：

- 每轮 `done` 且结构化有效时：插入 message（含 structured_json）；`correction` 且非 uncertain → 插入 mistakes；`vocabulary` → upsert vocabulary（已存在则 seen_count+1）。
- 课文识别确认后：插入 lesson、lesson_assets、课程生词 upsert（source=lesson）。
- 复习节奏：固定间隔 1 / 3 / 7 / 14 天；`review_count` 每复习一次 +1，取对应间隔；"标记已掌握"置 mastered，不再出现。
- 删除会话：删 messages、practice_sessions、Claude 会话文件；mistakes / vocabulary 保留，conversation_id / source_id 置空。
- 设置项：model、voice、rate、autoSpeak、difficulty(beginner/intermediate/advanced)、chineseExplanations、whisperBinaryPath、whisperModelPath、lastProfileAnalysisAt。

## 7. 学习逻辑

### 7.1 五种模式

| 模式       | 提示词               | 会话级上下文                                                         |
| ---------- | -------------------- | -------------------------------------------------------------------- |
| 自由聊天   | free-chat.md         | 无                                                                   |
| 课文问答   | lesson-qa.md         | 课程正文 + 中文注释                                                  |
| 角色扮演   | role-play.md         | 预设场景（机场、出租车、餐厅、购物、看病挂号、工作会议）中的角色设定 |
| 场景任务   | scenario-task.md     | 预设场景 + 一个明确目标；AI 在判断完成时置 `taskCompleted`           |
| 针对性练习 | targeted-practice.md | 画像中 2～3 个薄弱点 + 到期复习的 ≤ 5 条错句                         |

`base-tutor.md` 固定规则：按难度控制词汇与句长；每次只问一个主要问题；优先纠正影响理解的错误；给自然表达 + 简短中文解释；每轮 ≤ 3 个生词；区分 ASR 不确定与真实错误；不把每轮都变成语法课；先写 reply 再填结构化字段。

### 7.2 会话小结

触发：离开会话或应用退出时，若该会话 `turn_count ≥ 3` 且 `practice_sessions.summary_json` 为空。`analyze` 输入最近消息（≤ 20 条，纯文本）+ 本会话错句；输出 `{ practiced: string; performanceZh: string; issues: string[] }` 写入 `summary_json`。失败静默，下次再试。

### 7.3 学习画像

触发：学习分析页"更新分析"按钮；应用启动时 `lastProfileAnalysisAt` 超过 24 小时且有新的错句或小结。`analyze` 输入：近 30 天错句按 category 计数与样例（每类 ≤ 5 条）、生词总数与熟悉度分布、最近 ≤ 10 条会话小结、上一版画像。输出：

```ts
LearnerProfile = { level: "A1"|"A2"|"B1"|"B2"|"C1"; weaknesses: string[]; progress: string[];
                   suggestions: string[]; summaryZh: string }
```

画像摘要（level + weaknesses）注入之后每个新会话的系统提示。

### 7.4 针对性练习选材

`weaknesses` 取前 3；`mistakes` 取 `status=pending` 且 `next_review_at <= now` 的前 5 条（按 next_review_at 升序）。会话创建时写入系统提示；会话结束时这 5 条错句 `review_count + 1` 并推进 `next_review_at`。

## 8. 界面与状态

### 8.1 导航

左侧：聊天、课程、错句本、生词本、学习分析、设置。

### 8.2 聊天

- 左列会话列表（新建 / 切换 / 删除）；新建弹窗选模式，课文问答再选课程，角色扮演 / 场景任务再选预设场景，针对性练习直接开始。
- 主区消息列表。AI 消息三块：回复正文（流式）、可折叠纠错卡（原句 / 改后 / 中文解释 / 类型 / "可能是识别错误"标记）、生词条（点开看释义例句）。
- 底部输入条：文本框、图片按钮、麦克风、发送 / 停止、朗读按钮（读最近一条 AI 回复）。
- 粘贴 / 拖拽 / 选择图片 → 直接弹"识别为学习内容"对话框（预览、移除、确认上传提示 → 识别 → 编辑标题 / 正文 / 生词 → 保存课程 → 自动新建课文问答会话）。
- 语音识别完成后文字填入输入框，带"来自语音识别"标记；置信度低于阈值标黄。

### 8.3 状态机（每会话）

```
idle → recording → transcribing → awaiting_confirmation → sending → streaming → speaking → idle
任一状态 → error → idle
```

互斥：transcribing 时不能开始录音；streaming 时发送键变停止；recording 或 sending 开始时自动停止 speaking；切换会话时停止 speaking；切换会话不取消进行中的回复，该回复在后台完成并落库；切回时可见。

### 8.4 其他页面

- 课程：列表、详情（正文、注释、原图、生词）、从文本新建、删除、"开始课文问答"。
- 错句本：按类型筛选、到期优先、标记已掌握、删除。
- 生词本：搜索、熟悉度调整、标记已掌握、删除。
- 学习分析：水平、薄弱点、近期进步、建议、中文总结、统计（错句按类型、生词数与熟悉度分布、练习次数与总轮数）、"更新分析"、"开始针对性练习"。
- 设置：Claude 连接检测、模型、whisper 二进制 / 模型状态与下载删除、音色、语速、自动朗读、难度、中文解释开关、数据目录路径、隐私说明。

## 9. 错误处理总览

| 情况                       | 行为                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| Claude 未登录 / 二进制缺失 | 发送失败，消息标 error，提示去设置页检测，给出 `claude login` 指引 |
| 限流 / 网络                | 显示"重试中（第 n 次）"，SDK 重试耗尽后标 error，可重发            |
| 用户停止生成               | abort，已收到的文本保留为 assistant 消息，不写错句 / 生词          |
| 结构化缺失 / 校验失败      | 纯文本展示，不写错句 / 生词                                        |
| 麦克风被拒                 | 引导打开系统设置                                                   |
| 空录音 / 静音              | 提示，不调识别                                                     |
| whisper 二进制或模型缺失   | 麦克风按钮禁用并提示去设置页                                       |
| 识别失败 / 超时            | 回 idle，提示可重录或打字                                          |
| TTS 失败                   | 提示，聊天不受影响                                                 |
| 数据库迁移失败             | 启动时弹窗并退出，不覆盖数据                                       |

## 10. 测试

Vitest（主进程与 shared）：

- 系统提示拼装（每种模式、有无画像、有无课程）。
- TutorResponse / LessonExtraction / LearnerProfile zod 校验与降级路径。
- ClaudeCliProvider 事件映射（用假的 SDK 消息流）。
- WAV 编码、重采样、RMS 静音判断。
- whisper JSON 解析与置信度计算。
- 各表读写、迁移、删除会话的级联规则（内存 SQLite）。
- 复习间隔计算、针对性练习选材、画像输入聚合。

UI 开发与 IPC 联调用 Fake 实现。真机手动清单（录音权限、口音、延迟、CPU / 内存、打包后登录复用、模型缺失引导、升级后数据保留）按原需求文档第 10 节执行。

## 11. 打包

- electron-builder，`mac` `arm64` `dmg`，不公证。
- `asarUnpack`: `@anthropic-ai/claude-agent-sdk*`（含 `claude-agent-sdk-darwin-arm64` 里的二进制）。
- `extendInfo.NSMicrophoneUsageDescription`；hardened runtime entitlements 含 `com.apple.security.device.audio-input`。
- 子进程 env 显式传入并补全 PATH（Finder 启动时 PATH 极简，需包含 `/opt/homebrew/bin` 以找到 `whisper-cli`）。

## 12. 阶段计划

| 阶段              | 内容                                                                                                                                                                                                              | 验收                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0 技术验证        | 建工程；`brew install whisper.cpp` + 下载 small.en + 一段 wav 跑通；Electron 主进程经 SDK 调 Claude：Finder 启动复用登录（其余三项已在 Node 下实测，见第 2 节）；`say` 跑通；`node:sqlite` 在 Electron 主进程可用 | 结论写回本 spec 第 2 节                                                |
| 1 文字聊天 + 课程 | 基础表（conversations / messages / lessons / lesson_assets / settings）、Provider、聊天 UI、自由聊天与课文问答、图片 / 文本识别成课程、提示词 v1                                                                  | 可连续聊天；上传课文图片，确认文本后围绕课文提问；重启后会话与课程仍在 |
| 2 语音闭环        | 录音、whisper、say、状态机、权限引导、模型下载                                                                                                                                                                    | 说英语 → 转写 → 修改 → AI 回答 → 朗读 → 停止，全程状态正确             |
| 3 学习记录与画像  | mistakes / vocabulary / practice_sessions / learner_profile、错句本、生词本、复习节奏、会话小结、学习分析页、针对性练习、角色扮演与场景任务                                                                       | 几次练习后分析页有画像；针对性练习会引出薄弱点；错句可复习与标记       |
| 4 稳定与打包      | electron-builder、asar 解包、权限描述、各类失败降级、手动清单                                                                                                                                                     | dmg 在本机干净安装可启动，关键功能可用，失败可恢复                     |
