# my-tutor

**AI 英语陪练 · 桌面应用（macOS / Windows）· 可接入多家大模型** ｜ [English](#english)

让大模型当你的英语老师：打字或开口说英语，AI 用简单自然的英文回答，同时给出中文纠错和重点生词；错句、生词、学习画像都存在本地，再按你的薄弱点出针对性练习。

```
文字 / 课文图片 → AI 对话（纠错 + 生词）→ 本地朗读 → 本地记录 → 学习画像 → 针对性练习
```

## 功能

- **五种练习模式**：自由聊天、课文问答、角色扮演、场景任务、针对性练习。
- **课文变课程**：粘贴、拖拽或选择课文图片（最多 4 张）或文本文件，AI 识别成课程（正文、注释、生词），然后围绕课文对话。
- **语音输入**：点麦克风说英语，[whisper.cpp](https://github.com/ggml-org/whisper.cpp) 在本机识别，可修改后发送；录音识别完即删，不上传。
- **纠错与生词**：每轮回复附中文纠错卡（原句 / 改后 / 解释 / 类型）和 1～3 个重点词。区分"可能是识别错误"与真实语法错误。
- **本地朗读**：用 macOS 自带 `say` 朗读回复，可选音色、语速、自动朗读。
- **错句本 / 生词本**：错句按间隔复习自动安排到期，可标记已掌握；生词按熟悉度管理。
- **学习画像**：离开会话后台生成小结；学习分析页给出水平、薄弱点、建议和统计，一键开始针对性练习。
- **界面多语言**：中文 / English，可扩展。

## 支持的大模型与平台

| AI 后端           | 接入方式                                 | 状态      |
| ----------------- | ---------------------------------------- | --------- |
| Claude            | 本机已登录的 Claude Code（无需 API Key） | ✅ 已支持 |
| ChatGPT（OpenAI） | OpenAI API Key                           | 🚧 规划中 |
| 通义千问（Qwen）  | 阿里云百炼 API Key（OpenAI 兼容接口）    | 🚧 规划中 |
| DeepSeek          | DeepSeek API Key（OpenAI 兼容接口）      | 🚧 规划中 |

| 平台                   | 状态                                                          |
| ---------------------- | ------------------------------------------------------------- |
| macOS（Apple Silicon） | ✅ 已支持                                                     |
| Windows                | 🚧 规划中（朗读改用系统语音、whisper.cpp Windows 版、安装包） |

AI 调用都经过统一的 Provider 接口（`src/main/ai/types.ts`），对话、纠错、课文识别、学习画像都依赖同一套结构化输出，新增一个后端只需实现该接口。ChatGPT、千问、DeepSeek 都提供 OpenAI 兼容接口，计划用同一个 Provider 加不同的 Base URL 和 API Key 接入，在设置页切换。

## 工作方式（Claude 后端）

- **不需要 API Key**：通过 [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) 驱动**你本机已登录的 Claude Code**，用的是你自己的 Claude 订阅额度。每次调用都用精简配置（自定义系统提示、不加载用户设置、禁用工具），单轮约几百到两千输入 token。
- **数据都在本地**：会话、课程、错句、生词、画像存在本机 SQLite（`~/Library/Application Support/my-tutor/my-tutor.db`）。发给 Claude 的只有你输入的文字、确认后的课文文本，以及识别课程时的图片（仅一次）。
- 对话上下文交给 Claude Code 会话（resume）管理，应用不拼历史。

> 本项目仅供个人在自己的电脑上使用自己的 Claude 登录。请勿用它向他人提供你的 Claude 登录或订阅额度；如需给多人使用，应改为每位用户自己的 API Key。

## 环境要求

- macOS，Apple Silicon（M 系列）。目前只打 arm64 包；Windows 版规划中。
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) 已安装并登录（终端里运行 `claude` 完成登录）。其他大模型接入后改为在设置页填写 API Key。
- 语音输入（可选）：`brew install whisper.cpp`，模型 `ggml-small.en.bin`（约 466 MB）可在应用设置页一键下载。
- 开发：Node.js 22+、npm。

## 安装与运行

```bash
npm install
npm run dev          # 开发运行（真实 Claude）
npm run dev:fake     # 开发运行（假 AI，不消耗额度，适合调 UI）
npm test             # 单元测试（Vitest）
npm run build:mac    # 打包 dmg，产物在 dist/
```

打包产物未做 Apple 签名与公证；首次打开如被 macOS 拦截，在 Finder 里右键应用 → 打开。

首次使用：在「设置」里点「检测连接」确认 Claude 可用；需要语音的话下载识别模型，并在第一次点麦克风时允许麦克风权限。

## 技术栈

Electron · React · TypeScript · Tailwind CSS · electron-vite · `node:sqlite` · Claude Agent SDK · whisper.cpp · macOS `say` · Vitest · zod

```
src/
  main/       主进程：AI 调用、聊天与学习记录服务、数据库与迁移、语音识别、朗读、IPC
  preload/    向渲染进程暴露的 API
  renderer/   React 界面、状态管理、录音、i18n
  shared/     类型、IPC 通道、zod 校验
docs/         设计文档与实施计划
```

设计细节见 [`docs/superpowers/specs/2026-10-12-speakmate-design.md`](docs/superpowers/specs/2026-10-12-speakmate-design.md)。

## 不在第一版范围内

发音评分、实时全双工语音、跟读 / 复述模式、多用户与云同步、iOS 版本。

## 许可

[MIT](LICENSE)

---

<a id="english"></a>

## English

**my-tutor** is a desktop app for practicing English with an AI tutor.

- **AI backends**: Claude via your locally signed-in Claude Code (supported, no API key). ChatGPT, Qwen and DeepSeek via their OpenAI-compatible APIs (planned).
- **Platforms**: macOS on Apple Silicon (supported), Windows (planned).

- Type or speak English; replies come with a correction card (original / improved / explanation) and 1–3 key words.
- Turn textbook photos or text files into lessons and talk about them.
- Local speech recognition with whisper.cpp and local read-aloud with macOS `say`.
- Mistake book with spaced review, vocabulary book, session summaries, a learner profile, and targeted practice built from your weak points.
- All data stays in a local SQLite database. UI in Chinese or English.

Requirements today: macOS on Apple Silicon, Claude Code installed and logged in, optional `brew install whisper.cpp` for voice input.

```bash
npm install && npm run dev      # or: npm run dev:fake (no Claude calls)
npm run build:mac               # build the dmg
```

This project is meant for personal use with your own Claude login. Do not use it to share your Claude login or subscription with others.

License: MIT.
