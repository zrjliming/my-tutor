# my-tutor M2（阶段 2：本地语音闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 的文字聊天之上打通"点麦克风说英语 → 本地 whisper.cpp 转写 → 修改确认 → 发给 Claude → 回复用 macOS `say` 朗读 → 可停止"的完整语音闭环，含麦克风权限引导、模型下载管理和设置页语音区块。

**Architecture:** 渲染进程用 `getUserMedia` + AudioWorklet 采集 PCM，录完在渲染进程重采样到 16 kHz 单声道、编成 16 位 WAV，整块通过 IPC 交给主进程；主进程 `WhisperCliService` 把 WAV 写到临时文件、spawn `whisper-cli` 输出 JSON、解析后删除临时文件；`MacSayService` spawn `say` 并经 stdin 送文本，停止即杀进程；`ModelManager` 负责模型文件状态、下载（`.part` 临时文件 + 进度事件）和删除；`VoiceService` 组合三者并保证同一时刻只有一个识别任务、一个朗读进程。渲染进程沿用 M1 的八态状态机，新增 recording / transcribing / awaiting_confirmation / speaking 的真实流转。

**Tech Stack:** 与 M1 相同（electron-vite 5、Electron 39、React 19、TypeScript、Tailwind 4、zod 4、Vitest 5、`node:sqlite`）；新增依赖：无。外部：Homebrew `whisper.cpp` 1.9.5 的 `whisper-cli`，macOS 自带 `say`、`afconvert`（仅脚本用）。

**Spec:** `docs/superpowers/specs/2026-10-12-speakmate-design.md`（本计划实现第 5 节、第 8.3 节语音相关状态、第 8.4 节设置页语音区块、第 9 节语音相关错误行、第 12 节阶段 2）。M1 已合并到 master；本计划在 master 之上开分支 `m2`。

## Global Constraints

- 录音上限 `MAX_RECORDING_SECONDS = 60`，到时自动结束；WAV 为 16 kHz、单声道、16 位 PCM；单次音频 ≤ 2,100,000 字节（60 s × 16000 × 2 + 44 字节 ≈ 1.92 MB）。
- 发送前在渲染进程算整段 RMS，`rms < 0.01` 视为静音，直接提示"没听到声音"，不调识别。
- whisper 调用固定为 `whisper-cli -m <model> -f <wav> -l en -ojf -of <out> -np`，只解析 `<out>.json`（stdout 不可信）；置信度 = `tokens[].p` 的均值，**过滤 text 以 `[_` 开头的特殊 token**；置信度仅用于 UI 提示，`ASR_LOW_CONFIDENCE = 0.6` 以下标黄。识别超时 60 s 杀进程；同一时刻只允许一个识别任务；识别完成或失败后立即删除 WAV 与 JSON，默认不保留录音。
- `whisperBinaryPath` 默认 `/opt/homebrew/bin/whisper-cli`；`whisperModelPath` 为空时解析为 `userData/models/ggml-small.en.bin`；模型下载地址 `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`，先写 `.part` 再改名，`.part` 不算已下载。
- `say` 文本走 stdin，不走命令行参数；一次一个进程；新朗读先停旧朗读；开始录音、发送新消息、切换会话时自动停止朗读；`say` 进程带超时（`10 s + 文本长度 × 80 ms`，上限 120 s），超时杀进程；TTS 失败只提示，不影响聊天。默认音色 `Samantha`，语速 `175`，范围 100–300。
- 自动朗读开启时，每轮 `done` 后只朗读 `structured.reply`（没有 structured 时朗读纯文本回复），不朗读中文解释。
- 麦克风：首次录音前主进程 `systemPreferences.askForMediaAccess('microphone')`；被拒后 UI 给按钮打开 `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`。
- 子进程 env 一律经 M1 的 `cleanEnv`（PATH 含 `/opt/homebrew/bin`）。
- 渲染进程仍是 `sandbox: true`，不暴露 `ipcRenderer`；所有新 IPC 入参经 zod；音频以 `Uint8Array` 传递。
- 提交信息中文，结尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；每个任务提交前对改动文件跑 `npx prettier --write` 且 `npx eslint <files>` 0 警告。
- UI 文案中文；状态标签沿用 M1 的英文状态名。

## Review Focus

1. **识别进行中再按麦克风**：`transcribing` 状态下 `START_RECORDING` 必须被忽略，主进程对第二个 `voice:transcribe` 必须拒绝"上一次识别尚未结束"。测试：Task 1（状态机表已覆盖，补断言）、Task 7（`VoiceService` 并发拒绝）。
2. **静音录音**：整段 RMS 低于阈值时不调 whisper、提示"没听到声音"并回 idle。测试：Task 2（`isSilent`）、Task 8 手动。
3. **模型文件只有 `.part` 或大小为 0**：状态必须报"未下载"，下载重新开始并覆盖；删除要同时删 `.part`。测试：Task 6。
4. **`say` 挂起**：进程不退出时超时杀掉并以"朗读超时"结束，聊天不受影响。测试：Task 5。
5. **whisper 只返回特殊 token 或空转写**：解析结果 `text` 为空时服务抛 `empty`，UI 提示"没识别出内容，再试一次"，状态回 idle 而不是停在 transcribing。测试：Task 3（解析）、Task 4（服务抛错）、Task 8 手动。

---

## 文件结构

```
src/shared/
  types.ts        + ASRResult, TTSVoice, VoiceStatus, ModelProgressEvent, 常量
  schemas.ts      + TranscribeInputSchema, SpeakInputSchema; SettingsPatchSchema 扩展
  ipc.ts          + voice:* 通道与 SpeakMateAPI.voice
src/main/
  asr/types.ts            SpeechRecognitionService 接口、ASRError
  asr/whisper-json.ts     parseWhisperJson（纯函数）
  asr/whisper-cli.ts      WhisperCliService（spawn、临时文件、超时、取消）
  tts/types.ts            TTSService 接口、TTSError
  tts/mac-say.ts          MacSayService、parseSayVoices
  voice/model-manager.ts  ModelManager（状态、下载、删除）
  voice/service.ts        VoiceService（组合、互斥、设置解析）
  ipc/register.ts         + voice 通道
  index.ts                + 装配、麦克风权限、系统设置跳转
src/preload/index.ts      + voice API
src/renderer/
  public/recorder-worklet.js        AudioWorkletProcessor（纯 JS）
  src/lib/wav.ts                    encodeWav16、rms、isSilent（纯函数）
  src/lib/recorder.ts               Recorder（getUserMedia + worklet + 重采样）
  src/hooks/useRecorder.ts          录音状态与计时
  src/store/ChatStore.tsx           + transcribe / speak / stopSpeaking / 自动朗读
  src/state/chatReducer.ts          + asr 草稿状态
  src/components/InputBar.tsx       受控输入、麦克风/计时/转写标记
  src/components/ChatPage.tsx       接线
  src/components/MessageBubble.tsx  朗读按钮
  src/components/SettingsPage.tsx   语音区块
```

---

### Task 1: 共享类型、schema 与 IPC 定义

**Files:**
- Modify: `src/shared/types.ts`、`src/shared/schemas.ts`、`src/shared/ipc.ts`
- Test: `src/shared/voice-schemas.test.ts`、`src/renderer/src/state/machine.test.ts`（补一条断言）

**Interfaces:**
- Produces（后续任务按名引用）：

```ts
// types.ts
export interface ASRResult { text: string; confidence: number; segments: Array<{ text: string; startMs: number; endMs: number }> }
export interface TTSVoice { id: string; label: string; lang: string }
export interface VoiceStatus { binaryPath: string; binaryFound: boolean; modelPath: string; modelFound: boolean; modelBytes: number | null; downloading: boolean }
export type ModelProgressEvent =
  | { type: 'progress'; received: number; total: number | null }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
export type ASRErrorKind = 'binary_missing' | 'model_missing' | 'timeout' | 'aborted' | 'empty' | 'failed'
export type TranscribeOutcome = { ok: true; result: ASRResult } | { ok: false; kind: ASRErrorKind; message: string }
export type SpeakOutcome = { ok: true } | { ok: false; kind: 'timeout' | 'failed'; message: string }
export const MAX_RECORDING_SECONDS = 60
export const MAX_WAV_BYTES = 2_100_000
export const ASR_LOW_CONFIDENCE = 0.6
export const SILENCE_RMS = 0.01
export const WHISPER_MODEL_FILE = 'ggml-small.en.bin'
export const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
export const TTS_RATE_MIN = 100
export const TTS_RATE_MAX = 300
// schemas.ts
export const TranscribeInputSchema   // { wav: Uint8Array ≤ MAX_WAV_BYTES }
export const SpeakInputSchema        // { text: 1..4000 trimmed }
export const SettingsPatchSchema     // + voice, rate, whisperBinaryPath, whisperModelPath
// ipc.ts
IPC.voiceStatus … IPC.voiceModelProgress（见代码）
SpeakMateAPI.voice: { status, transcribe(wav) → TranscribeOutcome, cancelTranscribe, speak(text) → SpeakOutcome, stopSpeaking, listVoices, downloadModel, cancelDownload, deleteModel, requestMic, openMicSettings, onModelProgress }
（识别/朗读的失败通过返回值的 ok:false 传回渲染进程，不用 IPC 异常，这样渲染进程能拿到 kind）
```

- [ ] **Step 1: 写失败的测试 `src/shared/voice-schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SettingsPatchSchema, SpeakInputSchema, TranscribeInputSchema } from './schemas'
import { MAX_WAV_BYTES } from './types'

describe('TranscribeInputSchema', () => {
  it('accepts a Uint8Array within the size limit', () => {
    expect(TranscribeInputSchema.safeParse({ wav: new Uint8Array(44) }).success).toBe(true)
  })
  it('rejects oversized audio and non-binary input', () => {
    expect(TranscribeInputSchema.safeParse({ wav: new Uint8Array(MAX_WAV_BYTES + 1) }).success).toBe(false)
    expect(TranscribeInputSchema.safeParse({ wav: 'abc' }).success).toBe(false)
    expect(TranscribeInputSchema.safeParse({ wav: new Uint8Array(0) }).success).toBe(false)
  })
})

describe('SpeakInputSchema', () => {
  it('trims and bounds text', () => {
    expect(SpeakInputSchema.parse({ text: '  hello ' }).text).toBe('hello')
    expect(SpeakInputSchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(SpeakInputSchema.safeParse({ text: 'a'.repeat(4001) }).success).toBe(false)
  })
})

describe('SettingsPatchSchema voice fields', () => {
  it('accepts voice, rate within 100..300 and whisper paths', () => {
    expect(
      SettingsPatchSchema.safeParse({ voice: 'Daniel', rate: 200, whisperBinaryPath: '/opt/homebrew/bin/whisper-cli', whisperModelPath: '' })
        .success
    ).toBe(true)
  })
  it('rejects out-of-range rate and non-integer rate', () => {
    expect(SettingsPatchSchema.safeParse({ rate: 99 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ rate: 301 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ rate: 150.5 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: 给 `src/renderer/src/state/machine.test.ts` 的 `ignores illegal events` 用例补两条断言**

```ts
    expect(transition('transcribing', 'START_RECORDING')).toBe('transcribing')
    expect(transition('recording', 'SEND')).toBe('recording')
```

（第一条若已存在则只加第二条。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/shared/voice-schemas.test.ts`
Expected: FAIL，`TranscribeInputSchema` / `SpeakInputSchema` 不存在，`SettingsPatchSchema` 不认识 `rate`（当前 schema 会 strip 未知键，所以 rate 99 用例会错误地通过——这正是要加约束的原因）。

- [ ] **Step 4: 扩展 `src/shared/types.ts`**

在文件末尾追加：

```ts
// ---- 语音（阶段 2） ----
export interface ASRResult {
  text: string
  confidence: number
  segments: Array<{ text: string; startMs: number; endMs: number }>
}

export interface TTSVoice {
  id: string
  label: string
  lang: string
}

export interface VoiceStatus {
  binaryPath: string
  binaryFound: boolean
  modelPath: string
  modelFound: boolean
  modelBytes: number | null
  downloading: boolean
}

export type ModelProgressEvent =
  | { type: 'progress'; received: number; total: number | null }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export type ASRErrorKind = 'binary_missing' | 'model_missing' | 'timeout' | 'aborted' | 'empty' | 'failed'

export type TranscribeOutcome =
  | { ok: true; result: ASRResult }
  | { ok: false; kind: ASRErrorKind; message: string }

export type SpeakOutcome = { ok: true } | { ok: false; kind: 'timeout' | 'failed'; message: string }

export const MAX_RECORDING_SECONDS = 60
export const MAX_WAV_BYTES = 2_100_000
export const ASR_LOW_CONFIDENCE = 0.6
export const SILENCE_RMS = 0.01
export const WHISPER_MODEL_FILE = 'ggml-small.en.bin'
export const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
export const TTS_RATE_MIN = 100
export const TTS_RATE_MAX = 300
```

- [ ] **Step 5: 扩展 `src/shared/schemas.ts`**

把 `SettingsPatchSchema` 改为：

```ts
export const SettingsPatchSchema = z.object({
  model: z.string().max(50).optional(),
  difficulty: DifficultySchema.optional(),
  chineseExplanations: z.boolean().optional(),
  autoSpeak: z.boolean().optional(),
  voice: z.string().min(1).max(60).optional(),
  rate: z.number().int().min(100).max(300).optional(),
  whisperBinaryPath: z.string().max(500).optional(),
  whisperModelPath: z.string().max(500).optional()
})
```

文件末尾追加：

```ts
export const TranscribeInputSchema = z.object({
  wav: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 44 && b.byteLength <= 2_100_000, { message: '音频大小不合法' })
})

export const SpeakInputSchema = z.object({
  text: z.string().trim().min(1).max(4000)
})
```

- [ ] **Step 6: 扩展 `src/shared/ipc.ts`**

`import type` 列表加 `ModelProgressEvent, SpeakOutcome, TranscribeOutcome, TTSVoice, VoiceStatus`。`IPC` 常量对象末尾加：

```ts
  voiceStatus: 'voice:status',
  voiceTranscribe: 'voice:transcribe',
  voiceCancelTranscribe: 'voice:cancelTranscribe',
  voiceSpeak: 'voice:speak',
  voiceStopSpeaking: 'voice:stopSpeaking',
  voiceListVoices: 'voice:listVoices',
  voiceDownloadModel: 'voice:downloadModel',
  voiceCancelDownload: 'voice:cancelDownload',
  voiceDeleteModel: 'voice:deleteModel',
  voiceRequestMic: 'voice:requestMic',
  voiceOpenMicSettings: 'voice:openMicSettings',
  voiceModelProgress: 'voice:modelProgress'
```

`SpeakMateAPI` 末尾加：

```ts
  voice: {
    status(): Promise<VoiceStatus>
    transcribe(wav: Uint8Array): Promise<TranscribeOutcome>
    cancelTranscribe(): Promise<void>
    speak(text: string): Promise<SpeakOutcome>
    stopSpeaking(): Promise<void>
    listVoices(): Promise<TTSVoice[]>
    downloadModel(): Promise<void>
    cancelDownload(): Promise<void>
    deleteModel(): Promise<void>
    requestMic(): Promise<boolean>
    openMicSettings(): Promise<void>
    onModelProgress(cb: (event: ModelProgressEvent) => void): () => void
  }
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run src/shared src/renderer/src/state && npm run typecheck`
Expected: PASS。typecheck 会因为 `src/preload/index.ts` 的 `api: SpeakMateAPI` 缺少 `voice` 而报错——这是预期的，在本任务先给 preload 加一个临时实现以保持 typecheck 绿（Task 7 会替换）：

```ts
  voice: {
    status: () => ipcRenderer.invoke(IPC.voiceStatus),
    transcribe: (wav) => ipcRenderer.invoke(IPC.voiceTranscribe, { wav }),
    cancelTranscribe: () => ipcRenderer.invoke(IPC.voiceCancelTranscribe),
    speak: (text) => ipcRenderer.invoke(IPC.voiceSpeak, { text }),
    stopSpeaking: () => ipcRenderer.invoke(IPC.voiceStopSpeaking),
    listVoices: () => ipcRenderer.invoke(IPC.voiceListVoices),
    downloadModel: () => ipcRenderer.invoke(IPC.voiceDownloadModel),
    cancelDownload: () => ipcRenderer.invoke(IPC.voiceCancelDownload),
    deleteModel: () => ipcRenderer.invoke(IPC.voiceDeleteModel),
    requestMic: () => ipcRenderer.invoke(IPC.voiceRequestMic),
    openMicSettings: () => ipcRenderer.invoke(IPC.voiceOpenMicSettings),
    onModelProgress: (cb) => {
      const listener = (_e: unknown, event: ModelProgressEvent): void => cb(event)
      ipcRenderer.on(IPC.voiceModelProgress, listener)
      return () => {
        ipcRenderer.removeListener(IPC.voiceModelProgress, listener)
      }
    }
  }
```

（`import type { ChatIpcEvent, ModelProgressEvent } from '@shared/types'`。）这段就是 preload 的最终代码，Task 7 只需确认它存在。

- [ ] **Step 8: 提交**

```bash
git add src/shared src/preload src/renderer/src/state/machine.test.ts
git commit -m "feat: 语音相关共享类型、schema 与 IPC 定义

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 渲染进程音频：WAV 编码、静音判断、Worklet 与 Recorder

**Files:**
- Create: `src/renderer/src/lib/wav.ts`、`src/renderer/public/recorder-worklet.js`、`src/renderer/src/lib/recorder.ts`
- Test: `src/renderer/src/lib/wav.test.ts`

**Interfaces:**
- Produces：

```ts
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array   // 44 字节头 + PCM16LE
export function rms(samples: Float32Array): number
export function isSilent(samples: Float32Array, threshold?: number): boolean          // 默认 SILENCE_RMS
export class Recorder {
  constructor(opts: { onTick?: (seconds: number) => void; onError?: (message: string) => void; maxSeconds?: number })
  start(): Promise<void>                       // 申请麦克风、建 AudioContext、挂 worklet
  stop(): Promise<Float32Array>                // 停止采集，返回 16 kHz 单声道样本
  cancel(): void                               // 丢弃，释放资源
  readonly active: boolean
}
```

- [ ] **Step 1: 写失败的测试 `src/renderer/src/lib/wav.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { encodeWav16, rms, isSilent } from './wav'

const readU32 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint32(o, true)
const readU16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint16(o, true)
const readI16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getInt16(o, true)
const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n))

describe('encodeWav16', () => {
  it('writes a canonical 44-byte PCM header for 16 kHz mono', () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000)
    expect(wav.byteLength).toBe(44 + 5 * 2)
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(readU32(wav, 4)).toBe(36 + 10)
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 12, 4)).toBe('fmt ')
    expect(readU32(wav, 16)).toBe(16)
    expect(readU16(wav, 20)).toBe(1) // PCM
    expect(readU16(wav, 22)).toBe(1) // mono
    expect(readU32(wav, 24)).toBe(16000)
    expect(readU32(wav, 28)).toBe(32000) // byte rate
    expect(readU16(wav, 32)).toBe(2) // block align
    expect(readU16(wav, 34)).toBe(16) // bits
    expect(ascii(wav, 36, 4)).toBe('data')
    expect(readU32(wav, 40)).toBe(10)
  })
  it('scales and clamps samples to int16', () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 1.5, -1.5]), 16000)
    expect(readI16(wav, 44)).toBe(0)
    expect(readI16(wav, 46)).toBe(16383)
    expect(readI16(wav, 48)).toBe(-16384)
    expect(readI16(wav, 50)).toBe(32767)
    expect(readI16(wav, 52)).toBe(-32768)
  })
})

describe('rms / isSilent', () => {
  it('computes rms and flags near-silence', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(isSilent(new Float32Array(1600).fill(0.001))).toBe(true)
    expect(isSilent(new Float32Array(1600).fill(0.05))).toBe(false)
    expect(isSilent(new Float32Array(0))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/lib/wav.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/renderer/src/lib/wav.ts`**

```ts
import { SILENCE_RMS } from '@shared/types'

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true)
  }
  return new Uint8Array(buffer)
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function isSilent(samples: Float32Array, threshold = SILENCE_RMS): boolean {
  return rms(samples) < threshold
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/src/lib/wav.test.ts`
Expected: PASS。

- [ ] **Step 5: 写 `src/renderer/public/recorder-worklet.js`**

（纯 JS，不经 TypeScript；Vite 会把 `public/` 原样拷到输出根目录。）

```js
// 把输入第 0 声道的 Float32 样本按块发回主线程；不做任何处理。
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0))
    }
    return true
  }
}
registerProcessor('recorder-processor', RecorderProcessor)
```

- [ ] **Step 6: 写 `src/renderer/src/lib/recorder.ts`**

```ts
import { MAX_RECORDING_SECONDS } from '@shared/types'

export interface RecorderOptions {
  onTick?: (seconds: number) => void
  onError?: (message: string) => void
  maxSeconds?: number
}

const TARGET_RATE = 16000

async function resampleTo16k(chunks: Float32Array[], sourceRate: number): Promise<Float32Array> {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  if (total === 0) return merged
  if (sourceRate === TARGET_RATE) return merged
  const length = Math.ceil((total * TARGET_RATE) / sourceRate)
  const ctx = new OfflineAudioContext(1, length, TARGET_RATE)
  const buffer = ctx.createBuffer(1, total, sourceRate)
  buffer.copyToChannel(merged, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0).slice(0)
}

export class Recorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private chunks: Float32Array[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private seconds = 0
  private readonly maxSeconds: number

  constructor(private readonly opts: RecorderOptions = {}) {
    this.maxSeconds = opts.maxSeconds ?? MAX_RECORDING_SECONDS
  }

  get active(): boolean {
    return this.node !== null
  }

  async start(): Promise<void> {
    if (this.active) throw new Error('已在录音')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    await context.audioWorklet.addModule('./recorder-worklet.js')
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, 'recorder-processor')
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.chunks.push(e.data)
    }
    source.connect(node)
    // 不连到 destination，避免回放到扬声器
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.opts.onError?.('麦克风已断开')
      void this.stop()
    })
    this.stream = stream
    this.context = context
    this.node = node
    this.chunks = []
    this.seconds = 0
    this.timer = setInterval(() => {
      this.seconds += 1
      this.opts.onTick?.(this.seconds)
      if (this.seconds >= this.maxSeconds) void this.stop()
    }, 1000)
  }

  async stop(): Promise<Float32Array> {
    if (!this.active) return new Float32Array(0)
    const sourceRate = this.context?.sampleRate ?? TARGET_RATE
    const chunks = this.chunks
    this.release()
    return resampleTo16k(chunks, sourceRate)
  }

  cancel(): void {
    this.release()
  }

  private release(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.node?.port.close()
    this.node?.disconnect()
    this.node = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.context?.close()
    this.context = null
    this.chunks = []
  }
}
```

- [ ] **Step 7: typecheck 与提交**

Run: `npm run typecheck && npx eslint src/renderer/src/lib src/renderer/public/recorder-worklet.js`
Expected: 通过（若 eslint 对 `public/*.js` 报 `AudioWorkletProcessor`/`registerProcessor` 未定义，在该文件顶部加 `/* global AudioWorkletProcessor, registerProcessor */`）。

```bash
git add src/renderer/src/lib src/renderer/public
git commit -m "feat: 渲染进程录音：WAV 编码、静音判断、AudioWorklet 与 Recorder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: whisper JSON 解析与置信度

**Files:**
- Create: `src/main/asr/types.ts`、`src/main/asr/whisper-json.ts`
- Test: `src/main/asr/whisper-json.test.ts`

**Interfaces:**
- Produces：

```ts
// asr/types.ts
export interface SpeechRecognitionService {
  isReady(): Promise<{ binary: boolean; model: boolean }>
  transcribe(wav: Buffer, signal: AbortSignal): Promise<ASRResult>
}
export class ASRError extends Error { readonly kind: ASRErrorKind }
// asr/whisper-json.ts
export function parseWhisperJson(json: unknown): ASRResult   // text 为空字符串表示没识别出内容（由调用方抛 empty）
```

- [ ] **Step 1: 写失败的测试 `src/main/asr/whisper-json.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseWhisperJson } from './whisper-json'

// 与 scripts/probe-whisper.sh 在本机实测的 -ojf 输出结构一致（节选）
const sample = {
  systeminfo: 'x',
  model: { type: 'small' },
  params: { model: 'ggml-small.en.bin', language: 'en' },
  result: { language: 'en' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:03,400' },
      offsets: { from: 0, to: 3400 },
      text: ' I went to the airport yesterday',
      tokens: [
        { text: '[_BEG_]', timestamps: { from: '00:00:00,000', to: '00:00:00,000' }, offsets: { from: 0, to: 0 }, id: 50363, p: 0.99 },
        { text: ' I', offsets: { from: 0, to: 200 }, id: 314, p: 0.98 },
        { text: ' went', offsets: { from: 200, to: 500 }, id: 1816, p: 0.97 },
        { text: ' to', offsets: { from: 500, to: 600 }, id: 284, p: 0.99 },
        { text: ' the', offsets: { from: 600, to: 700 }, id: 262, p: 0.96 },
        { text: ' airport', offsets: { from: 700, to: 1200 }, id: 9003, p: 0.95 },
        { text: ' yesterday', offsets: { from: 1200, to: 1800 }, id: 7415, p: 0.9 },
        { text: '[_TT_164]', offsets: { from: 3400, to: 3400 }, id: 50527, p: 0.11 }
      ]
    },
    {
      timestamps: { from: '00:00:03,400', to: '00:00:05,000' },
      offsets: { from: 3400, to: 5000 },
      text: ' and bought a ticket.',
      tokens: [
        { text: ' and', offsets: { from: 3400, to: 3500 }, id: 1, p: 0.9 },
        { text: ' bought', offsets: { from: 3500, to: 3900 }, id: 2, p: 0.8 },
        { text: ' a', offsets: { from: 3900, to: 4000 }, id: 3, p: 0.9 },
        { text: ' ticket.', offsets: { from: 4000, to: 5000 }, id: 4, p: 0.8 }
      ]
    }
  ]
}

describe('parseWhisperJson', () => {
  it('joins segment text, keeps offsets, and averages p over non-special tokens', () => {
    const r = parseWhisperJson(sample)
    expect(r.text).toBe('I went to the airport yesterday and bought a ticket.')
    expect(r.segments).toEqual([
      { text: 'I went to the airport yesterday', startMs: 0, endMs: 3400 },
      { text: 'and bought a ticket.', startMs: 3400, endMs: 5000 }
    ])
    // 10 个普通 token：(0.98+0.97+0.99+0.96+0.95+0.9+0.9+0.8+0.9+0.8)/10 = 0.915；[_BEG_] 与 [_TT_164] 被过滤
    expect(r.confidence).toBeCloseTo(0.915, 3)
  })
  it('returns empty text and zero confidence when only special tokens exist', () => {
    const r = parseWhisperJson({ transcription: [{ offsets: { from: 0, to: 100 }, text: '', tokens: [{ text: '[_BEG_]', p: 0.9 }] }] })
    expect(r.text).toBe('')
    expect(r.confidence).toBe(0)
    expect(r.segments).toEqual([])
  })
  it('tolerates missing tokens (-oj output) with confidence 0', () => {
    const r = parseWhisperJson({ transcription: [{ offsets: { from: 0, to: 900 }, text: ' Hello.' }] })
    expect(r).toEqual({ text: 'Hello.', confidence: 0, segments: [{ text: 'Hello.', startMs: 0, endMs: 900 }] })
  })
  it('throws on malformed input', () => {
    expect(() => parseWhisperJson(null)).toThrow(/transcription/)
    expect(() => parseWhisperJson({ transcription: 'nope' })).toThrow(/transcription/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/asr`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/asr/types.ts`**

```ts
import type { ASRErrorKind, ASRResult } from '@shared/types'

export interface SpeechRecognitionService {
  isReady(): Promise<{ binary: boolean; model: boolean }>
  transcribe(wav: Buffer, signal: AbortSignal): Promise<ASRResult>
}

export class ASRError extends Error {
  constructor(
    public readonly kind: ASRErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'ASRError'
  }
}
```

- [ ] **Step 4: 写 `src/main/asr/whisper-json.ts`**

```ts
import type { ASRResult } from '@shared/types'

interface Token {
  text?: unknown
  p?: unknown
}
interface Segment {
  text?: unknown
  offsets?: { from?: unknown; to?: unknown }
  tokens?: unknown
}

const isSpecial = (text: string): boolean => text.trim().startsWith('[_')

export function parseWhisperJson(json: unknown): ASRResult {
  const root = json as { transcription?: unknown } | null
  if (!root || !Array.isArray(root.transcription)) {
    throw new Error('whisper JSON 缺少 transcription 数组')
  }
  const segments: ASRResult['segments'] = []
  const probs: number[] = []
  for (const raw of root.transcription as Segment[]) {
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const startMs = typeof raw.offsets?.from === 'number' ? raw.offsets.from : 0
    const endMs = typeof raw.offsets?.to === 'number' ? raw.offsets.to : startMs
    if (text) segments.push({ text, startMs, endMs })
    if (Array.isArray(raw.tokens)) {
      for (const t of raw.tokens as Token[]) {
        if (typeof t.text !== 'string' || typeof t.p !== 'number') continue
        if (isSpecial(t.text)) continue
        probs.push(t.p)
      }
    }
  }
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
  const confidence = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0
  return { text, confidence: text ? confidence : 0, segments }
}
```

- [ ] **Step 5: 跑测试确认通过，提交**

Run: `npx vitest run src/main/asr && npm run typecheck`
Expected: PASS。

```bash
git add src/main/asr
git commit -m "feat: whisper JSON 解析与置信度计算

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: WhisperCliService

**Files:**
- Create: `src/main/asr/whisper-cli.ts`
- Test: `src/main/asr/whisper-cli.test.ts`

**Interfaces:**
- Consumes：Task 3 `parseWhisperJson`、`ASRError`、`SpeechRecognitionService`；M1 `cleanEnv`（`src/main/ai/env.ts`）。
- Produces：

```ts
export interface WhisperConfig { binaryPath: string; modelPath: string }
export interface WhisperCliOptions {
  getConfig: () => WhisperConfig
  tmpDir: string
  timeoutMs?: number                       // 默认 60_000
  spawnFn?: typeof import('node:child_process').spawn
  env?: NodeJS.ProcessEnv
}
export class WhisperCliService implements SpeechRecognitionService
export function buildWhisperArgs(cfg: WhisperConfig, wavPath: string, outBase: string): string[]
```

- [ ] **Step 1: 写失败的测试 `src/main/asr/whisper-cli.test.ts`**

测试用一个临时目录里的可执行 shell 脚本冒充 `whisper-cli`：它把固定 JSON 写到 `-of` 指定的 `<base>.json`，或根据环境变量模拟挂起 / 失败。

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWhisperArgs, WhisperCliService } from './whisper-cli'

let dir: string
let fakeBin: string
let model: string
const wav = Buffer.alloc(100, 1)

function writeFakeBinary(body: string): void {
  writeFileSync(fakeBin, `#!/bin/sh\n${body}\n`)
  chmodSync(fakeBin, 0o755)
}

// 解析参数里的 -of <base>，写 <base>.json
const WRITE_JSON = `
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-of" ]; then out="$2"; fi
  shift
done
cat > "$out.json" <<'JSON'
{"transcription":[{"offsets":{"from":0,"to":1000},"text":" Hello there.","tokens":[{"text":"[_BEG_]","p":0.5},{"text":" Hello","p":0.9},{"text":" there.","p":0.7}]}]}
JSON
echo "some stdout noise"
`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'whisper-test-'))
  fakeBin = join(dir, 'whisper-cli')
  model = join(dir, 'ggml-small.en.bin')
  writeFileSync(model, 'model')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const svc = (extra: Partial<ConstructorParameters<typeof WhisperCliService>[0]> = {}): WhisperCliService =>
  new WhisperCliService({ getConfig: () => ({ binaryPath: fakeBin, modelPath: model }), tmpDir: dir, ...extra })

describe('buildWhisperArgs', () => {
  it('uses the verified flag set', () => {
    expect(buildWhisperArgs({ binaryPath: '/b', modelPath: '/m.bin' }, '/t/a.wav', '/t/a')).toEqual([
      '-m', '/m.bin', '-f', '/t/a.wav', '-l', 'en', '-ojf', '-of', '/t/a', '-np'
    ])
  })
})

describe('WhisperCliService', () => {
  it('isReady reports binary and model presence', async () => {
    writeFakeBinary(WRITE_JSON)
    expect(await svc().isReady()).toEqual({ binary: true, model: true })
    expect(await svc({ getConfig: () => ({ binaryPath: '/nope/whisper-cli', modelPath: model }) }).isReady()).toEqual({ binary: false, model: true })
    expect(await svc({ getConfig: () => ({ binaryPath: fakeBin, modelPath: join(dir, 'missing.bin') }) }).isReady()).toEqual({ binary: true, model: false })
  })
  it('transcribes via the JSON file (not stdout) and deletes temp files', async () => {
    writeFakeBinary(WRITE_JSON)
    const r = await svc().transcribe(wav, new AbortController().signal)
    expect(r.text).toBe('Hello there.')
    expect(r.confidence).toBeCloseTo(0.8)
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav') || f.endsWith('.json'))).toEqual([])
  })
  it('throws binary_missing / model_missing before spawning', async () => {
    await expect(svc({ getConfig: () => ({ binaryPath: '/nope/whisper-cli', modelPath: model }) }).transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'binary_missing' })
    await expect(svc({ getConfig: () => ({ binaryPath: fakeBin, modelPath: '/nope.bin' }) }).transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'model_missing' })
  })
  it('throws empty when the transcript has no text', async () => {
    writeFakeBinary(`
out=""
while [ $# -gt 0 ]; do if [ "$1" = "-of" ]; then out="$2"; fi; shift; done
echo '{"transcription":[{"offsets":{"from":0,"to":10},"text":"","tokens":[{"text":"[_BEG_]","p":0.9}]}]}' > "$out.json"`)
    await expect(svc().transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'empty' })
  })
  it('throws failed when the process exits non-zero or writes no JSON', async () => {
    writeFakeBinary('echo "boom" >&2; exit 3')
    await expect(svc().transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'failed', message: expect.stringContaining('boom') })
  })
  it('times out and kills a hung process', async () => {
    writeFakeBinary('sleep 5')
    const t0 = Date.now()
    await expect(svc({ timeoutMs: 200 }).transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav'))).toEqual([])
  })
  it('aborts on signal and cleans up', async () => {
    writeFakeBinary('sleep 5')
    const ac = new AbortController()
    const p = svc().transcribe(wav, ac.signal)
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav'))).toEqual([])
  })
  it('rejects a second concurrent transcription', async () => {
    writeFakeBinary('sleep 1')
    const s = svc()
    const first = s.transcribe(wav, new AbortController().signal).catch(() => {})
    await expect(s.transcribe(wav, new AbortController().signal)).rejects.toMatchObject({ kind: 'failed', message: expect.stringContaining('尚未结束') })
    await first
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/asr/whisper-cli.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/asr/whisper-cli.ts`**

```ts
import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ASRResult } from '@shared/types'
import { cleanEnv } from '../ai/env'
import { ASRError, type SpeechRecognitionService } from './types'
import { parseWhisperJson } from './whisper-json'

export interface WhisperConfig {
  binaryPath: string
  modelPath: string
}

export interface WhisperCliOptions {
  getConfig: () => WhisperConfig
  tmpDir: string
  timeoutMs?: number
  spawnFn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
}

export function buildWhisperArgs(cfg: WhisperConfig, wavPath: string, outBase: string): string[] {
  return ['-m', cfg.modelPath, '-f', wavPath, '-l', 'en', '-ojf', '-of', outBase, '-np']
}

const fileExists = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export class WhisperCliService implements SpeechRecognitionService {
  private busy = false
  private readonly spawnFn: typeof nodeSpawn
  private readonly timeoutMs: number

  constructor(private readonly opts: WhisperCliOptions) {
    this.spawnFn = opts.spawnFn ?? nodeSpawn
    this.timeoutMs = opts.timeoutMs ?? 60_000
  }

  async isReady(): Promise<{ binary: boolean; model: boolean }> {
    const cfg = this.opts.getConfig()
    return { binary: fileExists(cfg.binaryPath), model: fileExists(cfg.modelPath) }
  }

  async transcribe(wav: Buffer, signal: AbortSignal): Promise<ASRResult> {
    if (this.busy) throw new ASRError('failed', '上一次识别尚未结束')
    const cfg = this.opts.getConfig()
    if (!fileExists(cfg.binaryPath)) throw new ASRError('binary_missing', `找不到 whisper-cli：${cfg.binaryPath}`)
    if (!fileExists(cfg.modelPath)) throw new ASRError('model_missing', `找不到模型文件：${cfg.modelPath}`)
    if (signal.aborted) throw new ASRError('aborted', '已取消')

    this.busy = true
    const base = join(this.opts.tmpDir, `asr-${randomUUID()}`)
    const wavPath = `${base}.wav`
    const jsonPath = `${base}.json`
    try {
      writeFileSync(wavPath, wav)
      await this.runProcess(cfg, wavPath, base, signal)
      if (!existsSync(jsonPath)) throw new ASRError('failed', 'whisper 没有产生 JSON 输出')
      const result = parseWhisperJson(JSON.parse(readFileSync(jsonPath, 'utf8')))
      if (!result.text) throw new ASRError('empty', '没识别出内容')
      return result
    } finally {
      rmSync(wavPath, { force: true })
      rmSync(jsonPath, { force: true })
      this.busy = false
    }
  }

  private runProcess(cfg: WhisperConfig, wavPath: string, base: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(cfg.binaryPath, buildWhisperArgs(cfg, wavPath, base), {
        env: cleanEnv(this.opts.env ?? process.env),
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let stderr = ''
      let settled = false
      const finish = (err?: ASRError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else resolve()
      }
      const kill = (): void => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已退出
        }
      }
      const onAbort = (): void => {
        kill()
        finish(new ASRError('aborted', '已取消'))
      }
      const timer = setTimeout(() => {
        kill()
        finish(new ASRError('timeout', `识别超过 ${Math.round(this.timeoutMs / 1000)} 秒，已中止`))
      }, this.timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (e) => finish(new ASRError('failed', `无法启动 whisper-cli：${e.message}`)))
      child.on('close', (code) => {
        if (code === 0) finish()
        else finish(new ASRError('failed', `whisper-cli 退出码 ${code}：${stderr.trim().slice(-400)}`))
      })
    })
  }
}
```

- [ ] **Step 4: 跑测试确认通过，提交**

Run: `npx vitest run src/main/asr && npm run typecheck`
Expected: PASS（超时与取消两条各约 0.2 s）。

```bash
git add src/main/asr
git commit -m "feat: WhisperCliService（子进程识别、临时文件、超时与取消）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: MacSayService（朗读）

**Files:**
- Create: `src/main/tts/types.ts`、`src/main/tts/mac-say.ts`
- Test: `src/main/tts/mac-say.test.ts`

**Interfaces:**
- Produces：

```ts
// tts/types.ts
export interface TTSService {
  speak(text: string, opts: { voice: string; rate: number }): Promise<void>   // 播放结束或被 stop 时 resolve；失败 reject TTSError
  stop(): Promise<void>
  listVoices(): Promise<TTSVoice[]>
}
export class TTSError extends Error { readonly kind: 'timeout' | 'failed' }
// tts/mac-say.ts
export function parseSayVoices(output: string): TTSVoice[]       // 只保留 en_* 音色
export function speakTimeoutMs(text: string): number             // min(120_000, 10_000 + text.length * 80)
export class MacSayService implements TTSService { constructor(opts?: { spawnFn?; env?; sayPath?: string }) }
```

- [ ] **Step 1: 写失败的测试 `src/main/tts/mac-say.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { MacSayService, parseSayVoices, speakTimeoutMs } from './mac-say'

const SAY_V = `Albert              en_US    # Hello! My name is Albert.
Daniel (英语（英国）)     en_GB    # Hello! My name is Daniel.
Samantha (英语（美国）)   en_US    # Hello! My name is Samantha.
Ting-Ting           zh_CN    # 你好，我叫 Ting-Ting。
Samantha (英语（美国）)   en_US    # Hello! My name is Samantha.
`

describe('parseSayVoices', () => {
  it('keeps english voices, dedupes, strips the localized suffix', () => {
    expect(parseSayVoices(SAY_V)).toEqual([
      { id: 'Albert', label: 'Albert', lang: 'en_US' },
      { id: 'Daniel', label: 'Daniel（英语（英国））', lang: 'en_GB' },
      { id: 'Samantha', label: 'Samantha（英语（美国））', lang: 'en_US' }
    ])
  })
})

describe('speakTimeoutMs', () => {
  it('scales with text length and caps at 120 s', () => {
    expect(speakTimeoutMs('hi')).toBe(10_160)
    expect(speakTimeoutMs('a'.repeat(5000))).toBe(120_000)
  })
})

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  killed: string | null = null
  written = ''
  constructor() {
    super()
    this.stdin.on('data', (d: Buffer) => (this.written += d.toString()))
  }
  kill(sig?: string): boolean {
    this.killed = sig ?? 'SIGTERM'
    setTimeout(() => this.emit('close', null, sig), 0)
    return true
  }
}

function fakeSpawn(): { spawnFn: (...a: unknown[]) => FakeChild; calls: Array<{ cmd: string; args: string[] }>; children: FakeChild[] } {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const children: FakeChild[] = []
  const spawnFn = (cmd: unknown, args: unknown): FakeChild => {
    calls.push({ cmd: String(cmd), args: args as string[] })
    const c = new FakeChild()
    children.push(c)
    return c
  }
  return { spawnFn, calls, children }
}

describe('MacSayService', () => {
  it('spawns say with voice/rate, writes text to stdin, resolves on exit 0', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p = tts.speak('Hello world', { voice: 'Samantha', rate: 180 })
    await new Promise((r) => setTimeout(r, 0))
    expect(f.calls[0]).toEqual({ cmd: 'say', args: ['-v', 'Samantha', '-r', '180'] })
    expect(f.children[0].written).toBe('Hello world')
    f.children[0].emit('close', 0)
    await expect(p).resolves.toBeUndefined()
  })
  it('stop kills the running process and the pending speak resolves', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p = tts.speak('Long text', { voice: 'Samantha', rate: 175 })
    await new Promise((r) => setTimeout(r, 0))
    await tts.stop()
    expect(f.children[0].killed).toBe('SIGTERM')
    await expect(p).resolves.toBeUndefined()
  })
  it('a new speak stops the previous one first', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p1 = tts.speak('one', { voice: 'Samantha', rate: 175 })
    await new Promise((r) => setTimeout(r, 0))
    const p2 = tts.speak('two', { voice: 'Samantha', rate: 175 })
    await new Promise((r) => setTimeout(r, 0))
    expect(f.children[0].killed).toBe('SIGTERM')
    await expect(p1).resolves.toBeUndefined()
    f.children[1].emit('close', 0)
    await expect(p2).resolves.toBeUndefined()
  })
  it('times out a hung process with a TTSError', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never, timeoutMs: () => 30 })
    await expect(tts.speak('hang', { voice: 'Samantha', rate: 175 })).rejects.toMatchObject({ kind: 'timeout' })
    expect(f.children[0].killed).toBe('SIGKILL')
  })
  it('rejects with failed on non-zero exit', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p = tts.speak('x', { voice: 'Nope', rate: 175 })
    await new Promise((r) => setTimeout(r, 0))
    f.children[0].emit('close', 1)
    await expect(p).rejects.toMatchObject({ kind: 'failed' })
  })
  it('listVoices runs say -v ? and parses stdout', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p = tts.listVoices()
    await new Promise((r) => setTimeout(r, 0))
    expect(f.calls[0].args).toEqual(['-v', '?'])
    f.children[0].stdout.write(SAY_V)
    f.children[0].emit('close', 0)
    expect((await p).map((v) => v.id)).toEqual(['Albert', 'Daniel', 'Samantha'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/tts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/tts/types.ts`**

```ts
import type { TTSVoice } from '@shared/types'

export interface TTSService {
  speak(text: string, opts: { voice: string; rate: number }): Promise<void>
  stop(): Promise<void>
  listVoices(): Promise<TTSVoice[]>
}

export class TTSError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'failed',
    message: string
  ) {
    super(message)
    this.name = 'TTSError'
  }
}
```

- [ ] **Step 4: 写 `src/main/tts/mac-say.ts`**

```ts
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { TTSVoice } from '@shared/types'
import { cleanEnv } from '../ai/env'
import { TTSError, type TTSService } from './types'

export interface MacSayOptions {
  spawnFn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
  sayPath?: string
  timeoutMs?: (text: string) => number
}

export function speakTimeoutMs(text: string): number {
  return Math.min(120_000, 10_000 + text.length * 80)
}

export function parseSayVoices(output: string): TTSVoice[] {
  const seen = new Set<string>()
  const voices: TTSVoice[] = []
  for (const line of output.split('\n')) {
    const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/.exec(line)
    if (!m) continue
    const raw = m[1].trim()
    const lang = m[2]
    if (!lang.startsWith('en_')) continue
    const id = raw.replace(/\s*[(（].*$/, '').trim()
    if (seen.has(id)) continue
    seen.add(id)
    const suffix = /[(（](.*)[)）]\s*$/.exec(raw)?.[1]
    voices.push({ id, label: suffix ? `${id}（${suffix}）` : id, lang })
  }
  return voices
}

export class MacSayService implements TTSService {
  private current: { child: ChildProcess; done: Promise<void> } | null = null
  private readonly spawnFn: typeof nodeSpawn
  private readonly sayPath: string
  private readonly timeoutFor: (text: string) => number

  constructor(private readonly opts: MacSayOptions = {}) {
    this.spawnFn = opts.spawnFn ?? nodeSpawn
    this.sayPath = opts.sayPath ?? 'say'
    this.timeoutFor = opts.timeoutMs ?? speakTimeoutMs
  }

  async speak(text: string, { voice, rate }: { voice: string; rate: number }): Promise<void> {
    await this.stop()
    const child = this.spawnFn(this.sayPath, ['-v', voice, '-r', String(rate)], {
      env: cleanEnv(this.opts.env ?? process.env),
      stdio: ['pipe', 'ignore', 'ignore']
    })
    const done = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: TTSError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.current?.child === child) this.current = null
        if (err) reject(err)
        else resolve()
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已退出
        }
        finish(new TTSError('timeout', '朗读超时，已中止'))
      }, this.timeoutFor(text))
      child.on('error', (e) => finish(new TTSError('failed', `无法启动 say：${e.message}`)))
      child.on('close', (code, sig) => {
        if (code === 0 || sig === 'SIGTERM') finish()
        else finish(new TTSError('failed', `say 退出码 ${code}`))
      })
    })
    this.current = { child, done }
    child.stdin?.end(text)
    return done
  }

  async stop(): Promise<void> {
    const cur = this.current
    if (!cur) return
    try {
      cur.child.kill('SIGTERM')
    } catch {
      // 已退出
    }
    await cur.done.catch(() => {})
  }

  listVoices(): Promise<TTSVoice[]> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.sayPath, ['-v', '?'], {
        env: cleanEnv(this.opts.env ?? process.env),
        stdio: ['ignore', 'pipe', 'ignore']
      })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
      child.on('error', (e) => reject(new TTSError('failed', e.message)))
      child.on('close', () => resolve(parseSayVoices(out)))
    })
  }
}
```

- [ ] **Step 5: 跑测试确认通过，提交**

Run: `npx vitest run src/main/tts && npm run typecheck`
Expected: PASS。

```bash
git add src/main/tts
git commit -m "feat: MacSayService（say 子进程朗读、停止、超时、音色列表）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: ModelManager（模型状态、下载、删除）

**Files:**
- Create: `src/main/voice/model-manager.ts`
- Test: `src/main/voice/model-manager.test.ts`

**Interfaces:**
- Produces：

```ts
export interface ModelManagerOptions {
  modelPath: () => string                    // 由 VoiceService 根据设置解析
  url?: string                               // 默认 WHISPER_MODEL_URL
  fetchFn?: typeof fetch                     // 默认 Electron net.fetch（由装配处注入）
  onProgress: (e: ModelProgressEvent) => void
}
export class ModelManager {
  status(): { modelPath: string; modelFound: boolean; modelBytes: number | null; downloading: boolean }
  download(): Promise<void>                  // 并发调用时直接返回进行中的 promise
  cancel(): void
  delete(): void                             // 删除模型与 .part
}
```

- [ ] **Step 1: 写失败的测试 `src/main/voice/model-manager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelProgressEvent } from '@shared/types'
import { ModelManager } from './model-manager'

let dir: string
let modelPath: string
let events: ModelProgressEvent[]

const streamOf = (chunks: string[], delayMs = 0): ReadableStream<Uint8Array> =>
  new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        controller.enqueue(new TextEncoder().encode(c))
      }
      controller.close()
    }
  })

const okFetch =
  (chunks: string[], total: number | null = null, delayMs = 0): typeof fetch =>
  async () =>
    new Response(streamOf(chunks, delayMs), {
      status: 200,
      headers: total === null ? {} : { 'content-length': String(total) }
    })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-test-'))
  modelPath = join(dir, 'ggml-small.en.bin')
  events = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const mk = (fetchFn: typeof fetch): ModelManager =>
  new ModelManager({ modelPath: () => modelPath, url: 'https://example/m.bin', fetchFn, onProgress: (e) => events.push(e) })

describe('ModelManager.status', () => {
  it('ignores .part and zero-byte files', () => {
    const m = mk(okFetch([]))
    expect(m.status()).toMatchObject({ modelFound: false, modelBytes: null, downloading: false })
    writeFileSync(`${modelPath}.part`, 'partial')
    expect(m.status().modelFound).toBe(false)
    writeFileSync(modelPath, '')
    expect(m.status().modelFound).toBe(false)
    writeFileSync(modelPath, 'abc')
    expect(m.status()).toMatchObject({ modelFound: true, modelBytes: 3 })
  })
})

describe('ModelManager.download', () => {
  it('streams to .part, renames on completion, reports progress and done', async () => {
    const m = mk(okFetch(['abc', 'def'], 6))
    await m.download()
    expect(readFileSync(modelPath, 'utf8')).toBe('abcdef')
    expect(existsSync(`${modelPath}.part`)).toBe(false)
    expect(events).toEqual([
      { type: 'progress', received: 3, total: 6 },
      { type: 'progress', received: 6, total: 6 },
      { type: 'done' }
    ])
  })
  it('reports error on non-2xx and leaves no model file', async () => {
    const m = mk(async () => new Response('nope', { status: 404 }))
    await m.download()
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('404') })
    expect(existsSync(modelPath)).toBe(false)
    expect(existsSync(`${modelPath}.part`)).toBe(false)
  })
  it('cancel aborts, removes .part and reports cancelled', async () => {
    const m = mk(okFetch(['a', 'b', 'c', 'd'], 4, 30))
    const p = m.download()
    await new Promise((r) => setTimeout(r, 45))
    expect(m.status().downloading).toBe(true)
    m.cancel()
    await p
    expect(events.at(-1)).toEqual({ type: 'cancelled' })
    expect(existsSync(`${modelPath}.part`)).toBe(false)
    expect(existsSync(modelPath)).toBe(false)
  })
  it('a second download while one is running returns the same promise', async () => {
    const m = mk(okFetch(['ab'], 2, 20))
    const p1 = m.download()
    const p2 = m.download()
    expect(p2).toBe(p1)
    await p1
  })
  it('delete removes the model and any .part', () => {
    const m = mk(okFetch([]))
    writeFileSync(modelPath, 'x')
    writeFileSync(`${modelPath}.part`, 'y')
    m.delete()
    expect(existsSync(modelPath)).toBe(false)
    expect(existsSync(`${modelPath}.part`)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/voice`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写 `src/main/voice/model-manager.ts`**

```ts
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelProgressEvent } from '@shared/types'
import { WHISPER_MODEL_URL } from '@shared/types'

export interface ModelManagerOptions {
  modelPath: () => string
  url?: string
  fetchFn?: typeof fetch
  onProgress: (e: ModelProgressEvent) => void
}

export class ModelManager {
  private inflight: { promise: Promise<void>; ac: AbortController } | null = null
  private readonly url: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly opts: ModelManagerOptions) {
    this.url = opts.url ?? WHISPER_MODEL_URL
    this.fetchFn = opts.fetchFn ?? fetch
  }

  status(): { modelPath: string; modelFound: boolean; modelBytes: number | null; downloading: boolean } {
    const modelPath = this.opts.modelPath()
    let modelBytes: number | null = null
    try {
      const st = statSync(modelPath)
      if (st.isFile() && st.size > 0) modelBytes = st.size
    } catch {
      modelBytes = null
    }
    return { modelPath, modelFound: modelBytes !== null, modelBytes, downloading: this.inflight !== null }
  }

  download(): Promise<void> {
    if (this.inflight) return this.inflight.promise
    const ac = new AbortController()
    const promise = this.run(ac).finally(() => {
      this.inflight = null
    })
    this.inflight = { promise, ac }
    return promise
  }

  cancel(): void {
    this.inflight?.ac.abort()
  }

  delete(): void {
    const p = this.opts.modelPath()
    rmSync(p, { force: true })
    rmSync(`${p}.part`, { force: true })
  }

  private async run(ac: AbortController): Promise<void> {
    const modelPath = this.opts.modelPath()
    const partPath = `${modelPath}.part`
    mkdirSync(dirname(modelPath), { recursive: true })
    rmSync(partPath, { force: true })
    let out: ReturnType<typeof createWriteStream> | null = null
    try {
      const res = await this.fetchFn(this.url, { signal: ac.signal })
      if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
      const totalHeader = res.headers.get('content-length')
      const total = totalHeader ? Number(totalHeader) : null
      out = createWriteStream(partPath)
      const reader = res.body.getReader()
      // fetch 实现未必尊重 signal（测试里的假 fetch 就不），这里自己取消读取
      ac.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true })
      let received = 0
      for (;;) {
        if (ac.signal.aborted) throw new Error('已取消')
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        await new Promise<void>((resolve, reject) => out!.write(value, (e) => (e ? reject(e) : resolve())))
        this.opts.onProgress({ type: 'progress', received, total })
      }
      await new Promise<void>((resolve) => out!.end(resolve))
      out = null
      if (ac.signal.aborted) throw new Error('已取消')
      renameSync(partPath, modelPath)
      this.opts.onProgress({ type: 'done' })
    } catch (e) {
      if (out) await new Promise<void>((resolve) => out!.end(resolve))
      rmSync(partPath, { force: true })
      if (ac.signal.aborted) this.opts.onProgress({ type: 'cancelled' })
      else this.opts.onProgress({ type: 'error', message: String((e as Error)?.message ?? e) })
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过，提交**

Run: `npx vitest run src/main/voice && npm run typecheck`
Expected: PASS。

```bash
git add src/main/voice
git commit -m "feat: ModelManager（whisper 模型状态、下载进度、取消与删除）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: VoiceService、IPC 注册与主进程装配（含麦克风权限）

**Files:**
- Create: `src/main/voice/service.ts`
- Modify: `src/main/ipc/register.ts`、`src/main/index.ts`
- Test: `src/main/voice/service.test.ts`、`src/main/ipc/register.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 3 `ASRError` / `SpeechRecognitionService`；Task 4 `WhisperCliService` / `WhisperConfig`；Task 5 `MacSayService` / `TTSService` / `TTSError`；Task 6 `ModelManager`；Task 1 的类型与通道；M1 的 `registerHandler` / `registerVoidHandler`、`getSettings`、`resolvePaths`（`paths.tmpDir`、`paths.modelsDir`）。
- Produces：

```ts
export function resolveWhisperConfig(settings: AppSettings, modelsDir: string): WhisperConfig
export interface VoiceServiceDeps {
  asr: SpeechRecognitionService
  tts: TTSService
  models: ModelManager
  getSettings: () => AppSettings
  resolveConfig: () => WhisperConfig
}
export class VoiceService {
  constructor(deps: VoiceServiceDeps)
  status(): Promise<VoiceStatus>
  transcribe(wav: Uint8Array): Promise<TranscribeOutcome>
  cancelTranscribe(): void
  speak(text: string): Promise<SpeakOutcome>
  stopSpeaking(): Promise<void>
  listVoices(): Promise<TTSVoice[]>
  downloadModel(): Promise<void>
  cancelDownload(): void
  deleteModel(): void
  shutdown(): Promise<void>
}
// register.ts: Services 加 voice: VoiceService；registerIpc 第 3 个参数改为
//   hooks: { pickImages; requestMic: () => Promise<boolean>; openMicSettings: () => Promise<void> }
```

- [ ] **Step 1: 写失败的测试 `src/main/voice/service.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, type ASRResult, type TTSVoice } from '@shared/types'
import { ASRError, type SpeechRecognitionService } from '../asr/types'
import { TTSError, type TTSService } from '../tts/types'
import type { ModelManager } from './model-manager'
import { resolveWhisperConfig, VoiceService } from './service'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class FakeASR implements SpeechRecognitionService {
  calls = 0
  constructor(private readonly behavior: 'ok' | 'empty' | 'slow' = 'ok') {}
  async isReady(): Promise<{ binary: boolean; model: boolean }> {
    return { binary: true, model: true }
  }
  async transcribe(_wav: Buffer, signal: AbortSignal): Promise<ASRResult> {
    this.calls++
    if (this.behavior === 'empty') throw new ASRError('empty', '没识别出内容')
    if (this.behavior === 'slow') {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new ASRError('aborted', '已取消'))
        })
      })
    }
    return { text: 'hello', confidence: 0.9, segments: [] }
  }
}

class FakeTTS implements TTSService {
  spoken: Array<{ text: string; voice: string; rate: number }> = []
  stops = 0
  constructor(private readonly fail = false) {}
  async speak(text: string, opts: { voice: string; rate: number }): Promise<void> {
    this.spoken.push({ text, ...opts })
    if (this.fail) throw new TTSError('failed', 'say 退出码 1')
  }
  async stop(): Promise<void> {
    this.stops++
  }
  async listVoices(): Promise<TTSVoice[]> {
    return [{ id: 'Samantha', label: 'Samantha', lang: 'en_US' }]
  }
}

const fakeModels = (found = true): ModelManager =>
  ({
    status: () => ({ modelPath: '/m/ggml-small.en.bin', modelFound: found, modelBytes: found ? 10 : null, downloading: false }),
    download: async () => {},
    cancel: () => {},
    delete: () => {}
  }) as unknown as ModelManager

const mk = (asr: SpeechRecognitionService = new FakeASR(), tts: TTSService = new FakeTTS(), models = fakeModels()): VoiceService =>
  new VoiceService({
    asr,
    tts,
    models,
    getSettings: () => ({ ...DEFAULT_SETTINGS, voice: 'Daniel', rate: 190 }),
    resolveConfig: () => ({ binaryPath: '/opt/homebrew/bin/whisper-cli', modelPath: '/m/ggml-small.en.bin' })
  })

describe('resolveWhisperConfig', () => {
  it('falls back to defaults and the models dir', () => {
    expect(resolveWhisperConfig({ ...DEFAULT_SETTINGS, whisperBinaryPath: '', whisperModelPath: '' }, '/ud/models')).toEqual({
      binaryPath: '/opt/homebrew/bin/whisper-cli',
      modelPath: '/ud/models/ggml-small.en.bin'
    })
    expect(resolveWhisperConfig({ ...DEFAULT_SETTINGS, whisperBinaryPath: '/x/whisper', whisperModelPath: '/y/m.bin' }, '/ud/models')).toEqual({
      binaryPath: '/x/whisper',
      modelPath: '/y/m.bin'
    })
  })
})

describe('VoiceService', () => {
  it('status merges binary, model and download state', async () => {
    const s = await mk().status()
    expect(s).toMatchObject({ binaryPath: '/opt/homebrew/bin/whisper-cli', binaryFound: true, modelFound: true, modelBytes: 10, downloading: false })
  })
  it('transcribe returns ok with the result', async () => {
    const r = await mk().transcribe(new Uint8Array(100))
    expect(r).toEqual({ ok: true, result: { text: 'hello', confidence: 0.9, segments: [] } })
  })
  it('transcribe maps ASRError to ok:false with kind', async () => {
    const r = await mk(new FakeASR('empty')).transcribe(new Uint8Array(100))
    expect(r).toEqual({ ok: false, kind: 'empty', message: '没识别出内容' })
  })
  it('rejects a concurrent transcribe and supports cancel', async () => {
    const svc = mk(new FakeASR('slow'))
    const first = svc.transcribe(new Uint8Array(100))
    await sleep(10)
    expect(await svc.transcribe(new Uint8Array(100))).toMatchObject({ ok: false, kind: 'failed', message: expect.stringContaining('尚未结束') })
    svc.cancelTranscribe()
    expect(await first).toMatchObject({ ok: false, kind: 'aborted' })
  })
  it('speak uses the configured voice and rate and reports failures', async () => {
    const tts = new FakeTTS()
    expect(await mk(new FakeASR(), tts).speak('Hi there')).toEqual({ ok: true })
    expect(tts.spoken).toEqual([{ text: 'Hi there', voice: 'Daniel', rate: 190 }])
    expect(await mk(new FakeASR(), new FakeTTS(true)).speak('x')).toEqual({ ok: false, kind: 'failed', message: 'say 退出码 1' })
  })
  it('transcribe stops any speech first; shutdown stops speech and cancels transcription', async () => {
    const tts = new FakeTTS()
    const svc = mk(new FakeASR('slow'), tts)
    const p = svc.transcribe(new Uint8Array(100))
    await sleep(10)
    expect(tts.stops).toBe(1)
    await svc.shutdown()
    expect(tts.stops).toBe(2)
    expect(await p).toMatchObject({ ok: false, kind: 'aborted' })
  })
})
```

- [ ] **Step 2: 给 `src/main/ipc/register.test.ts` 加 voice 通道断言**

把该测试里构造 `registerIpc(...)` 的调用改为新签名，并补断言（在现有 `wires channels end to end` 用例内追加）：

```ts
    const voice = new VoiceService({
      asr: { isReady: async () => ({ binary: false, model: false }), transcribe: async () => ({ text: '', confidence: 0, segments: [] }) },
      tts: { speak: async () => {}, stop: async () => {}, listVoices: async () => [] },
      models: { status: () => ({ modelPath: '/m', modelFound: false, modelBytes: null, downloading: false }), download: async () => {}, cancel: () => {}, delete: () => {} } as never,
      getSettings: () => getSettings(db),
      resolveConfig: () => ({ binaryPath: '/nope', modelPath: '/m' })
    })
    registerIpc(ipc, { chat, lessons, ai, db, voice }, { pickImages: async () => [], requestMic: async () => true, openMicSettings: async () => {} })
    ...
    expect(await handlers.get(IPC.voiceStatus)!({})).toMatchObject({ binaryFound: false, modelFound: false })
    expect(await handlers.get(IPC.voiceRequestMic)!({})).toBe(true)
    await expect(handlers.get(IPC.voiceTranscribe)!({}, { wav: 'nope' })).rejects.toThrow(/参数无效/)
    await expect(handlers.get(IPC.voiceSpeak)!({}, { text: '' })).rejects.toThrow(/参数无效/)
```

（`import { VoiceService } from '../voice/service'`、`import { getSettings } from '../db/settings'`。通道集合断言 `Object.values(IPC).filter(c => c !== IPC.chatEvent)` 要再排除 `IPC.voiceModelProgress`。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/voice src/main/ipc`
Expected: FAIL，`./service` 不存在；register 测试因签名不符失败。

- [ ] **Step 4: 写 `src/main/voice/service.ts`**

```ts
import { join } from 'node:path'
import type { AppSettings, SpeakOutcome, TranscribeOutcome, TTSVoice, VoiceStatus } from '@shared/types'
import { DEFAULT_SETTINGS, WHISPER_MODEL_FILE } from '@shared/types'
import { ASRError, type SpeechRecognitionService } from '../asr/types'
import type { WhisperConfig } from '../asr/whisper-cli'
import { TTSError, type TTSService } from '../tts/types'
import type { ModelManager } from './model-manager'

export function resolveWhisperConfig(settings: AppSettings, modelsDir: string): WhisperConfig {
  return {
    binaryPath: settings.whisperBinaryPath || DEFAULT_SETTINGS.whisperBinaryPath,
    modelPath: settings.whisperModelPath || join(modelsDir, WHISPER_MODEL_FILE)
  }
}

export interface VoiceServiceDeps {
  asr: SpeechRecognitionService
  tts: TTSService
  models: ModelManager
  getSettings: () => AppSettings
  resolveConfig: () => WhisperConfig
}

export class VoiceService {
  private transcribing: AbortController | null = null

  constructor(private readonly deps: VoiceServiceDeps) {}

  async status(): Promise<VoiceStatus> {
    const cfg = this.deps.resolveConfig()
    const ready = await this.deps.asr.isReady()
    const m = this.deps.models.status()
    return {
      binaryPath: cfg.binaryPath,
      binaryFound: ready.binary,
      modelPath: m.modelPath,
      modelFound: m.modelFound,
      modelBytes: m.modelBytes,
      downloading: m.downloading
    }
  }

  async transcribe(wav: Uint8Array): Promise<TranscribeOutcome> {
    if (this.transcribing) return { ok: false, kind: 'failed', message: '上一次识别尚未结束' }
    const ac = new AbortController()
    this.transcribing = ac
    try {
      await this.deps.tts.stop()
      const buf = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength)
      const result = await this.deps.asr.transcribe(buf, ac.signal)
      return { ok: true, result }
    } catch (e) {
      if (e instanceof ASRError) return { ok: false, kind: e.kind, message: e.message }
      return { ok: false, kind: 'failed', message: String((e as Error)?.message ?? e) }
    } finally {
      if (this.transcribing === ac) this.transcribing = null
    }
  }

  cancelTranscribe(): void {
    this.transcribing?.abort()
  }

  async speak(text: string): Promise<SpeakOutcome> {
    const { voice, rate } = this.deps.getSettings()
    try {
      await this.deps.tts.speak(text, { voice, rate })
      return { ok: true }
    } catch (e) {
      if (e instanceof TTSError) return { ok: false, kind: e.kind, message: e.message }
      return { ok: false, kind: 'failed', message: String((e as Error)?.message ?? e) }
    }
  }

  stopSpeaking(): Promise<void> {
    return this.deps.tts.stop()
  }

  listVoices(): Promise<TTSVoice[]> {
    return this.deps.tts.listVoices()
  }

  downloadModel(): Promise<void> {
    return this.deps.models.download()
  }

  cancelDownload(): void {
    this.deps.models.cancel()
  }

  deleteModel(): void {
    this.deps.models.delete()
  }

  async shutdown(): Promise<void> {
    this.cancelTranscribe()
    await this.deps.tts.stop()
  }
}
```

- [ ] **Step 5: 修改 `src/main/ipc/register.ts`**

导入加 `SpeakInputSchema, TranscribeInputSchema`（来自 `@shared/schemas`）与 `import type { VoiceService } from '../voice/service'`。`Services` 加 `voice: VoiceService`。函数签名与新增注册：

```ts
export interface IpcHooks {
  pickImages: () => Promise<ImageInput[]>
  requestMic: () => Promise<boolean>
  openMicSettings: () => Promise<void>
}

export function registerIpc(
  ipc: IpcHandleTarget,
  { chat, lessons, ai, db, voice }: Services,
  hooks: IpcHooks
): void {
  // ...原有注册不变，只把 pickImages() 改为 hooks.pickImages()...
  registerVoidHandler(ipc, IPC.voiceStatus, () => voice.status())
  registerHandler(ipc, IPC.voiceTranscribe, TranscribeInputSchema, (i) => voice.transcribe(i.wav))
  registerVoidHandler(ipc, IPC.voiceCancelTranscribe, () => {
    voice.cancelTranscribe()
  })
  registerHandler(ipc, IPC.voiceSpeak, SpeakInputSchema, (i) => voice.speak(i.text))
  registerVoidHandler(ipc, IPC.voiceStopSpeaking, () => voice.stopSpeaking())
  registerVoidHandler(ipc, IPC.voiceListVoices, () => voice.listVoices())
  registerVoidHandler(ipc, IPC.voiceDownloadModel, () => voice.downloadModel())
  registerVoidHandler(ipc, IPC.voiceCancelDownload, () => {
    voice.cancelDownload()
  })
  registerVoidHandler(ipc, IPC.voiceDeleteModel, () => {
    voice.deleteModel()
  })
  registerVoidHandler(ipc, IPC.voiceRequestMic, () => hooks.requestMic())
  registerVoidHandler(ipc, IPC.voiceOpenMicSettings, () => hooks.openMicSettings())
}
```

- [ ] **Step 6: 修改 `src/main/index.ts`**

导入加：`net, shell, systemPreferences` 来自 `'electron'`；`WhisperCliService` / `resolveWhisperConfig` / `VoiceService` / `MacSayService` / `ModelManager`；`getSettings` 来自 `'./db/settings'`；`ModelProgressEvent` 类型。把 `send` 改成通用广播，并装配语音：

```ts
const broadcast = (channel: string, payload: unknown): void => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}
const send = (event: ChatIpcEvent): void => broadcast(IPC.chatEvent, event)

const resolveConfig = (): WhisperConfig => resolveWhisperConfig(getSettings(db), paths.modelsDir)
const asr = new WhisperCliService({ getConfig: resolveConfig, tmpDir: paths.tmpDir })
const tts = new MacSayService()
const models = new ModelManager({
  modelPath: () => resolveConfig().modelPath,
  fetchFn: (input, init) => net.fetch(input as string, init),
  onProgress: (e: ModelProgressEvent) => broadcast(IPC.voiceModelProgress, e)
})
voice = new VoiceService({ asr, tts, models, getSettings: () => getSettings(db), resolveConfig })

registerIpc(
  ipcMain,
  { chat, lessons, ai, db, voice },
  {
    pickImages,
    requestMic: () => systemPreferences.askForMediaAccess('microphone'),
    openMicSettings: () =>
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  }
)
```

顶部 `let chat` 旁加 `let voice: VoiceService | undefined`，`before-quit` 改为：

```ts
app.on('before-quit', () => {
  chat?.cancelAll()
  void voice?.shutdown()
})
```

- [ ] **Step 7: 跑测试、typecheck、手动验证，提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全部 PASS。

Run: `npm run dev:fake`，在开发者工具 Console 执行：

```js
await window.speakmate.voice.status()
await window.speakmate.voice.listVoices()
await window.speakmate.voice.speak('Hello, this is a test.')
await window.speakmate.voice.requestMic()
```

Expected：`status` 显示 `binaryFound: true`，`modelFound` 取决于 `~/Library/Application Support/my-tutor/models/ggml-small.en.bin` 是否存在（M1 下载到的是旧目录 `speakmate/models`，把文件挪过来或等 Task 10 的下载按钮）；`listVoices` 含 Samantha、Daniel；`speak` 真的发出声音并在说完后 resolve `{ ok: true }`；`requestMic` 首次会弹系统权限框，返回布尔值。关闭窗口。

```bash
git add src/main
git commit -m "feat: VoiceService、语音 IPC 通道与主进程装配（含麦克风权限）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 渲染进程录音与转写流程（状态、Hook、输入条、聊天页）

**Files:**
- Create: `src/renderer/src/hooks/useRecorder.ts`
- Modify: `src/renderer/src/state/chatReducer.ts`、`src/renderer/src/store/ChatStore.tsx`、`src/renderer/src/components/InputBar.tsx`、`src/renderer/src/components/ChatPage.tsx`
- Test: `src/renderer/src/state/chatReducer.test.ts`（扩展）

**Interfaces:**
- Consumes：Task 2 `Recorder` / `encodeWav16` / `isSilent`；Task 1 `api.voice.transcribe` / `requestMic` / `openMicSettings` / `cancelTranscribe` / `status`；M1 状态机 `canRecord` / `isBusy`。
- Produces：

```ts
// chatReducer.ts 新增
state.asrDraft: Record<string, { confidence: number } | undefined>
action { type: 'asr/transcribed'; conversationId; confidence } | { type: 'asr/cleared'; conversationId }
// ChatStore.tsx 新增
transcribe(wav: Uint8Array): Promise<string | null>   // 成功返回文本并置 awaiting_confirmation；失败显示中文提示并回 idle，返回 null
cancelTranscribe(): Promise<void>
showError(message: string): void
asrDraft: { confidence: number } | null                // 当前会话
clearAsrDraft(): void
// useRecorder.ts
export function useRecorder(opts: { onError: (message: string) => void }): { seconds: number; start(): Promise<void>; stop(): Promise<Float32Array>; cancel(): void }
// InputBar.tsx 受控 props
{ ui; value; onChange(v); onSend(text) => Promise<void>; onStop(); onPickImage(); onMic(); micDisabled: boolean; micTitle: string; recordingSeconds: number | null; asr: { confidence: number } | null; onClearAsr() }
```

- [ ] **Step 1: 给 `src/renderer/src/state/chatReducer.test.ts` 加失败的测试**

```ts
  it('asr/transcribed stores the draft tag per conversation; asr/cleared removes it', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'asr/transcribed', conversationId: 'a', confidence: 0.42 })
    expect(s.asrDraft.a).toEqual({ confidence: 0.42 })
    expect(s.asrDraft.b).toBeUndefined()
    s = chatReducer(s, { type: 'asr/cleared', conversationId: 'a' })
    expect(s.asrDraft.a).toBeUndefined()
  })
  it('message/userSent clears the asr draft of that conversation', () => {
    let s = withTwoConversations()
    s = chatReducer(s, { type: 'messages/loaded', conversationId: 'a', messages: [] })
    s = chatReducer(s, { type: 'asr/transcribed', conversationId: 'a', confidence: 0.9 })
    const user: Message = { id: 'u1', conversationId: 'a', role: 'user', content: 'hi', structured: null, status: 'done', fromAsr: true, createdAt: '' }
    s = chatReducer(s, { type: 'message/userSent', userMessage: user, assistantMessageId: 'a1' })
    expect(s.asrDraft.a).toBeUndefined()
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/src/state/chatReducer.test.ts`
Expected: FAIL（`asrDraft` 不存在 / 未知 action）。

- [ ] **Step 3: 修改 `src/renderer/src/state/chatReducer.ts`**

`ChatState` 加 `asrDraft: Record<string, { confidence: number } | undefined>`；`initialState` 加 `asrDraft: {}`；`ChatAction` 加：

```ts
  | { type: 'asr/transcribed'; conversationId: string; confidence: number }
  | { type: 'asr/cleared'; conversationId: string }
```

reducer 加两个 case，并在 `message/userSent` 返回前把该会话的 `asrDraft` 置 `undefined`：

```ts
    case 'asr/transcribed':
      return { ...state, asrDraft: { ...state.asrDraft, [action.conversationId]: { confidence: action.confidence } } }
    case 'asr/cleared':
      return { ...state, asrDraft: { ...state.asrDraft, [action.conversationId]: undefined } }
```

（`message/userSent` 里：`asrDraft: { ...state.asrDraft, [id]: undefined }` 并入返回的 state。）`conversation/deleted` 时同样删掉该键。

- [ ] **Step 4: 跑 reducer 测试确认通过**

Run: `npx vitest run src/renderer/src/state`
Expected: PASS。

- [ ] **Step 5: 写 `src/renderer/src/hooks/useRecorder.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Recorder } from '../lib/recorder'

export function useRecorder(opts: { onError: (message: string) => void }): {
  seconds: number
  start(): Promise<void>
  stop(): Promise<Float32Array>
  cancel(): void
} {
  const [seconds, setSeconds] = useState(0)
  const ref = useRef<Recorder | null>(null)
  const onErrorRef = useRef(opts.onError)
  onErrorRef.current = opts.onError

  useEffect(() => () => ref.current?.cancel(), [])

  const start = useCallback(async () => {
    ref.current?.cancel()
    setSeconds(0)
    const rec = new Recorder({ onTick: setSeconds, onError: (m) => onErrorRef.current(m) })
    ref.current = rec
    await rec.start()
  }, [])

  const stop = useCallback(async () => {
    const rec = ref.current
    ref.current = null
    setSeconds(0)
    return rec ? rec.stop() : new Float32Array(0)
  }, [])

  const cancel = useCallback(() => {
    ref.current?.cancel()
    ref.current = null
    setSeconds(0)
  }, [])

  return { seconds, start, stop, cancel }
}
```

- [ ] **Step 6: 扩展 `src/renderer/src/store/ChatStore.tsx`**

`ChatContextValue` 加：

```ts
  asrDraft: { confidence: number } | null
  transcribe(wav: Uint8Array): Promise<string | null>
  cancelTranscribe(): Promise<void>
  clearAsrDraft(): void
  showError(message: string): void
```

在组件外层（模块级）加常量：

```ts
const ASR_TEXT: Record<string, string> = {
  binary_missing: '语音识别未就绪：找不到 whisper-cli，去设置页检查。',
  model_missing: '语音识别未就绪：模型未下载，去设置页下载。',
  empty: '没识别出内容，再试一次。',
  timeout: '识别超时，请缩短录音再试。',
  failed: '识别失败'
}
```

实现（放在 `clearError` 之后）：

```ts
  const showError = useCallback(
    (message: string) => {
      if (currentId) dispatch({ type: 'error/shown', conversationId: currentId, message })
    },
    [currentId]
  )

  const transcribe = useCallback(
    async (wav: Uint8Array): Promise<string | null> => {
      if (!currentId) return null
      const cid = currentId
      dispatch({ type: 'ui', conversationId: cid, event: 'STOP_RECORDING' })
      const outcome = await api.voice.transcribe(wav)
      if (outcome.ok) {
        dispatch({ type: 'asr/transcribed', conversationId: cid, confidence: outcome.result.confidence })
        dispatch({ type: 'ui', conversationId: cid, event: 'TRANSCRIBED' })
        return outcome.result.text
      }
      dispatch({ type: 'ui', conversationId: cid, event: 'STOP' })
      if (outcome.kind !== 'aborted') {
        const base = ASR_TEXT[outcome.kind] ?? '识别失败'
        dispatch({
          type: 'error/shown',
          conversationId: cid,
          message: outcome.kind === 'failed' ? `${base}：${outcome.message}` : base
        })
      }
      return null
    },
    [currentId]
  )

  const cancelTranscribe = useCallback(async () => api.voice.cancelTranscribe(), [])

  const clearAsrDraft = useCallback(() => {
    if (currentId) dispatch({ type: 'asr/cleared', conversationId: currentId })
  }, [currentId])
```

`value` 的 `useMemo` 加 `asrDraft: currentId ? (state.asrDraft[currentId] ?? null) : null` 与四个新函数（deps 同步补上）。

- [ ] **Step 7: 重写 `src/renderer/src/components/InputBar.tsx` 为受控组件**

```tsx
import { useState, type KeyboardEvent } from 'react'
import { ASR_LOW_CONFIDENCE, MAX_RECORDING_SECONDS } from '@shared/types'
import { canRecord, canSend, isBusy, type UiState } from '../state/machine'

interface Props {
  ui: UiState
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onPickImage: () => void
  onMic: () => void
  micDisabled: boolean
  micTitle: string
  recordingSeconds: number | null
  asr: { confidence: number } | null
  onClearAsr: () => void
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function InputBar(p: Props): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const busy = isBusy(p.ui)
  const recording = p.ui === 'recording'
  const transcribing = p.ui === 'transcribing'
  const submit = (): void => {
    const t = p.value.trim()
    if (!t || !canSend(p.ui) || sending) return
    setSending(true)
    p.onSend(t)
      .then(() => p.onChange(''))
      .catch(() => {})
      .finally(() => setSending(false))
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const btn =
    'w-9 h-9 rounded-lg inline-flex items-center justify-center border border-line disabled:opacity-40'
  const plain = `${btn} bg-surface text-fg-2`
  const low = p.asr !== null && p.asr.confidence < ASR_LOW_CONFIDENCE
  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5 flex flex-col gap-2">
      {p.asr && (
        <span
          className={`self-start inline-flex items-center gap-1.5 text-[11.5px] px-2 py-0.5 rounded ${low ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'}`}
        >
          🎙 来自语音识别{low ? ' · 识别不确定，请检查' : ''}
          <button className="ml-1" title="清除标记" onClick={p.onClearAsr}>
            ✕
          </button>
        </span>
      )}
      <div className="flex items-end gap-2">
        <button className={plain} title="选择图片，识别为学习内容" onClick={p.onPickImage} disabled={busy || recording || transcribing}>
          🖼
        </button>
        <textarea
          id="chat-input"
          className="flex-1 min-w-0 resize-none h-10 max-h-30 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-2 focus:outline-accent"
          placeholder={transcribing ? '正在识别…' : '输入英文，或点麦克风说话…'}
          value={p.value}
          onChange={(e) => {
            p.onChange(e.target.value)
            if (p.asr && e.target.value === '') p.onClearAsr()
          }}
          onKeyDown={onKey}
          maxLength={4000}
          disabled={recording || transcribing}
        />
        {p.recordingSeconds !== null && (
          <span className="font-mono text-xs text-bad min-w-[42px]">
            {fmt(p.recordingSeconds)} / {fmt(MAX_RECORDING_SECONDS)}
          </span>
        )}
        <button
          className={recording ? `${btn} bg-bad text-white border-transparent` : plain}
          title={recording ? '结束录音' : p.micTitle}
          onClick={p.onMic}
          disabled={p.micDisabled || transcribing || busy || (!recording && !canRecord(p.ui))}
        >
          {recording ? '■' : '🎤'}
        </button>
        {busy || transcribing ? (
          <button className={`${btn} bg-bad-soft text-bad`} title={transcribing ? '取消识别' : '停止生成'} onClick={p.onStop}>
            ■
          </button>
        ) : (
          <button
            className={`${btn} bg-accent text-white border-transparent`}
            title="发送"
            onClick={submit}
            disabled={!canSend(p.ui) || !p.value.trim() || sending || recording}
          >
            ➤
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: 修改 `src/renderer/src/components/ChatPage.tsx`**

新增 state 与逻辑（放在现有 `const chat = useChat()` 之后）：

```tsx
  const [text, setText] = useState('')
  const [micDenied, setMicDenied] = useState(false)
  const [voiceReady, setVoiceReady] = useState<{ ok: boolean; reason: string }>({ ok: false, reason: '检查语音识别状态…' })
  const recorder = useRecorder({ onError: (m) => chat.showError(m) })

  useEffect(() => {
    void api.voice.status().then((s) => {
      if (!s.binaryFound) setVoiceReady({ ok: false, reason: '语音识别未就绪：找不到 whisper-cli，去设置页检查' })
      else if (!s.modelFound) setVoiceReady({ ok: false, reason: '语音识别未就绪：模型未下载，去设置页下载' })
      else setVoiceReady({ ok: true, reason: '开始录音' })
    })
  }, [])

  // 切换会话时清空输入与录音（recorder.cancel 是稳定的 useCallback，不会让 effect 每次渲染都跑）
  const currentIdForEffect = chat.current?.id ?? null
  const cancelRecording = recorder.cancel
  useEffect(() => {
    setText('')
    cancelRecording()
  }, [currentIdForEffect, cancelRecording])

  const onMic = async (): Promise<void> => {
    if (chat.ui === 'recording') {
      const samples = await recorder.stop()
      if (isSilent(samples)) {
        chat.dispatchUi('STOP')
        chat.showError('没听到声音，请靠近麦克风再试。')
        return
      }
      const result = await chat.transcribe(encodeWav16(samples, 16000))
      if (result !== null) setText(result)
      return
    }
    const allowed = await api.voice.requestMic()
    if (!allowed) {
      chat.showError('麦克风权限被拒绝。请在“系统设置 → 隐私与安全性 → 麦克风”里允许 my-tutor。')
      setMicDenied(true)
      return
    }
    try {
      await recorder.start()
      chat.dispatchUi('START_RECORDING')
    } catch (e) {
      chat.showError(`无法开始录音：${String((e as Error)?.message ?? e)}`)
    }
  }

  const onStop = (): void => {
    if (chat.ui === 'transcribing') void chat.cancelTranscribe()
    else void chat.cancel()
  }
```

（`import { useEffect, useRef, useState, ... } from 'react'`、`import { api } from '../api'`、`import { useRecorder } from '../hooks/useRecorder'`、`import { encodeWav16, isSilent } from '../lib/wav'`。）

错误横幅里加"打开系统设置"按钮（在现有 `知道了` 旁）：

```tsx
                {micDenied && (
                  <button className="underline" onClick={() => void api.voice.openMicSettings()}>
                    打开系统设置
                  </button>
                )}
```

`InputBar` 的使用改为：

```tsx
            <InputBar
              ui={chat.ui}
              value={text}
              onChange={setText}
              onSend={(t) => chat.sendMessage(t, chat.asrDraft !== null)}
              onStop={onStop}
              onPickImage={() => onOpenLessonDialog()}
              onMic={() => void onMic()}
              micDisabled={!voiceReady.ok}
              micTitle={voiceReady.reason}
              recordingSeconds={chat.ui === 'recording' ? recorder.seconds : null}
              asr={chat.asrDraft}
              onClearAsr={() => {
                chat.clearAsrDraft()
                if (!text) chat.dispatchUi('INPUT_CLEARED')
              }}
            />
```

- [ ] **Step 9: 手动验证**

Run: `npm run typecheck && npx vitest run && npm run dev:fake`（whisper 和 say 都是真实本机能力，Fake 只替换 Claude。先确认模型文件在 `~/Library/Application Support/my-tutor/models/ggml-small.en.bin`，没有就把 M1 下载到 `.../speakmate/models/` 的那份挪过来。）

Expected：
1. 新建会话后麦克风按钮可用（title "开始录音"）；首次点击弹系统麦克风权限框，允许后按钮变红 ■，计时显示 `0:01 / 1:00`，状态条 `recording`。
2. 说一句英文再点 ■：状态 `transcribing`（输入框占位"正在识别…"，发送键变成"取消识别"），1 秒左右后文字填进输入框，出现绿色"来自语音识别"标记，状态 `awaiting_confirmation`；回车发送，用户气泡下方显示"🎙 语音输入"。
3. 录音 1 秒不说话再点 ■：横幅"没听到声音"，状态回 `idle`，不调 whisper。
4. 把输入框清空：标记消失，状态回 `idle`。
5. 把模型文件临时改名，重进聊天页：麦克风按钮禁用，悬停提示去设置页。改回来。
6. 识别过程中点"取消识别"：状态回 `idle`，无横幅。

- [ ] **Step 10: 提交**

```bash
git add src/renderer
git commit -m "feat: 录音、转写确认与麦克风权限的渲染进程流程

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 朗读：自动朗读、朗读按钮与停止规则

**Files:**
- Modify: `src/renderer/src/store/ChatStore.tsx`、`src/renderer/src/components/MessageBubble.tsx`、`src/renderer/src/components/MessageList.tsx`、`src/renderer/src/components/ChatPage.tsx`
- Test: `src/renderer/src/state/chatReducer.test.ts`（无新增 reducer 逻辑；本任务靠 typecheck + 手动验证）

**Interfaces:**
- Consumes：Task 1 `api.voice.speak` / `stopSpeaking`；状态机 `SPEAK` / `SPEAK_END`。
- Produces：

```ts
// ChatStore.tsx 新增
speak(text: string): Promise<void>        // SPEAK → api.voice.speak → SPEAK_END；失败显示"朗读失败：…"
stopSpeaking(): Promise<void>
// MessageBubble props 加 onSpeak?: (text: string) => void；MessageList 透传 onSpeak
```

- [ ] **Step 1: 扩展 `src/renderer/src/store/ChatStore.tsx`**

（react 导入加 `useRef`。）`ChatContextValue` 加 `speak(text: string): Promise<void>` 与 `stopSpeaking(): Promise<void>`。实现：

```ts
  const speak = useCallback(
    async (text: string) => {
      if (!currentId || !text.trim()) return
      const cid = currentId
      dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK' })
      const outcome = await api.voice.speak(text)
      dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK_END' })
      if (!outcome.ok) dispatch({ type: 'error/shown', conversationId: cid, message: `朗读失败：${outcome.message}` })
    },
    [currentId]
  )

  const stopSpeaking = useCallback(async () => api.voice.stopSpeaking(), [])
```

停止规则：
- `sendMessage` 开头加 `void api.voice.stopSpeaking()`；
- `select` 改为 `async (id) => { void api.voice.stopSpeaking(); dispatch(...) }`；
- `transcribe` 不用改（主进程 `VoiceService.transcribe` 已先停朗读）。

自动朗读：把 mount 时的 `api.chat.onEvent` 订阅改为通过 ref 读取最新的 `settings` 与 `currentId`：

```ts
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const currentIdRef = useRef<string | null>(null)
  currentIdRef.current = state.currentId
  const speakRef = useRef<(cid: string, text: string) => void>(() => {})

  useEffect(() => {
    ...原有 list/settings 加载...
    return api.chat.onEvent((event) => {
      dispatch({ type: 'chat/event', event })
      if (
        event.type === 'done' &&
        settingsRef.current.autoSpeak &&
        event.conversationId === currentIdRef.current
      ) {
        const text = event.structured?.reply ?? event.rawText
        if (text.trim()) speakRef.current(event.conversationId, text)
      }
    })
  }, [])
```

`speakRef.current` 在每次渲染时赋值为一个按会话 id 派发的版本（不用 `currentId` 闭包）：

```ts
  speakRef.current = (cid, text) => {
    dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK' })
    void api.voice.speak(text).then((outcome) => {
      dispatch({ type: 'ui', conversationId: cid, event: 'SPEAK_END' })
      if (!outcome.ok) dispatch({ type: 'error/shown', conversationId: cid, message: `朗读失败：${outcome.message}` })
    })
  }
```

（`speak(text)` 也改为调用 `speakRef.current(currentId, text)`，避免两份逻辑。）

- [ ] **Step 2: `MessageBubble.tsx` 加朗读按钮**

props 改为 `{ message: Message; onSpeak?: (text: string) => void }`；在 assistant 消息且 `message.status === 'done'` 时，meta 行加：

```tsx
        {!isUser && message.status === 'done' && onSpeak && (
          <button className="text-accent" onClick={() => onSpeak(message.content)}>
            🔈 朗读
          </button>
        )}
```

`MessageList.tsx` props 加 `onSpeak?: (text: string) => void` 并传给每个 `MessageBubble`。

- [ ] **Step 3: `ChatPage.tsx` 接线**

`<MessageList messages={chat.currentMessages} onSpeak={(t) => void chat.speak(t)} />`；头部状态条右侧加一个仅在 `chat.ui === 'speaking'` 时出现的按钮：

```tsx
              {chat.ui === 'speaking' && (
                <button className="text-xs px-2 py-0.5 rounded-md border border-line" onClick={() => void chat.stopSpeaking()}>
                  停止朗读
                </button>
              )}
```

- [ ] **Step 4: 手动验证**

Run: `npm run typecheck && npx vitest run && npm run dev:fake`

Expected：
1. 设置页"自动朗读 AI 回复"默认开：发一条消息，回复完成后自动用 Samantha 朗读 reply（不读中文解释），状态 `speaking`，头部出现"停止朗读"，点击后立刻停、状态回 `idle`。
2. 朗读中开始录音或发送新消息：朗读立刻停止。
3. 朗读中切换到另一个会话：朗读停止；在另一个会话完成的回复不会朗读当前会话之外的内容（Fake 流式 40 ms/词，切换会话后让旧会话完成，不应发声）。
4. 点任一已完成 AI 消息下方的"🔈 朗读"：朗读该条内容。
5. 在设置页把音色改成 Daniel、语速 220 后朗读：声音与语速随之变化（设置页改动在 Task 10 做；本任务可用 Console `window.speakmate.settings.patch({ voice: 'Daniel', rate: 220 })` 验证）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer
git commit -m "feat: AI 回复朗读（自动朗读、朗读按钮、停止规则）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 设置页语音区块

**Files:**
- Modify: `src/renderer/src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes：Task 1 `api.voice.status` / `listVoices` / `downloadModel` / `cancelDownload` / `deleteModel` / `onModelProgress`；M1 `useChat().settings / patchSettings`；常量 `TTS_RATE_MIN` / `TTS_RATE_MAX`。
- Produces：设置页"语音"区块替换占位文案。

- [ ] **Step 1: 在 `SettingsPage.tsx` 顶部加状态与副作用**

```tsx
import { useEffect, useState } from 'react'
import type { AICheckResult, ModelProgressEvent, TTSVoice, VoiceStatus } from '@shared/types'
import { TTS_RATE_MAX, TTS_RATE_MIN } from '@shared/types'
...
  const [voice, setVoice] = useState<VoiceStatus | null>(null)
  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [confirmDeleteModel, setConfirmDeleteModel] = useState(false)

  const refreshVoice = async (): Promise<void> => setVoice(await api.voice.status())

  useEffect(() => {
    void refreshVoice()
    void api.voice.listVoices().then(setVoices).catch(() => setVoices([]))
    return api.voice.onModelProgress((e: ModelProgressEvent) => {
      if (e.type === 'progress') setProgress({ received: e.received, total: e.total })
      else {
        setProgress(null)
        if (e.type === 'error') setVoiceError(`下载失败：${e.message}`)
        if (e.type === 'cancelled') setVoiceError('已取消下载')
        void refreshVoice()
      }
    })
  }, [])

  const startDownload = (): void => {
    setVoiceError(null)
    setProgress({ received: 0, total: null })
    void api.voice.downloadModel().then(refreshVoice)
  }
  const deleteModel = async (): Promise<void> => {
    if (!confirmDeleteModel) {
      setConfirmDeleteModel(true)
      setTimeout(() => setConfirmDeleteModel(false), 2500)
      return
    }
    setConfirmDeleteModel(false)
    await api.voice.deleteModel()
    await refreshVoice()
  }
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`
```

- [ ] **Step 2: 用下面的 JSX 替换"语音"占位区块**

```tsx
        <section className={card}>
          <h3 className="text-sm font-semibold">语音识别（whisper.cpp）</h3>
          <div className={kv}>
            <span className={k}>二进制</span>
            <span>
              {voice === null ? (
                <span className="text-fg-3">检查中…</span>
              ) : voice.binaryFound ? (
                <>
                  <span className="text-good">● 已找到</span> <span className="text-fg-3">{voice.binaryPath}</span>
                </>
              ) : (
                <>
                  <span className="text-bad">● 未找到</span>{' '}
                  <span className="text-fg-3">{voice.binaryPath}，请在终端运行 brew install whisper.cpp</span>
                </>
              )}
            </span>
            <span className={k}>模型</span>
            <span className="flex items-center gap-2 flex-wrap">
              {voice === null ? (
                <span className="text-fg-3">检查中…</span>
              ) : voice.modelFound ? (
                <>
                  <span className="text-good">● 已下载</span>
                  <span className="text-fg-3">ggml-small.en.bin · {mb(voice.modelBytes ?? 0)}</span>
                  <button className="text-xs px-2 py-1 rounded-md border border-line text-bad" onClick={() => void deleteModel()}>
                    {confirmDeleteModel ? '确认删除？' : '删除'}
                  </button>
                </>
              ) : progress ? (
                <>
                  <span className="text-fg-2">
                    下载中 {mb(progress.received)}
                    {progress.total ? ` / ${mb(progress.total)}` : ''}
                  </span>
                  <button className="text-xs px-2 py-1 rounded-md border border-line" onClick={() => void api.voice.cancelDownload()}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="text-bad">● 未下载</span>
                  <span className="text-fg-3">ggml-small.en.bin · 约 466 MB</span>
                  <button className="text-xs px-2 py-1 rounded-md border border-line" onClick={startDownload}>
                    下载
                  </button>
                </>
              )}
            </span>
            {progress && (
              <>
                <span className={k}></span>
                <span className="h-1.5 rounded bg-line overflow-hidden block w-full">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: progress.total ? `${Math.min(100, (progress.received / progress.total) * 100)}%` : '10%' }}
                  />
                </span>
              </>
            )}
          </div>
          {voiceError && <p className="text-xs text-bad m-0">{voiceError}</p>}
          <p className="text-xs text-fg-3 m-0">录音只在本机识别，识别完成后立即删除，不会上传。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">朗读</h3>
          <div className={kv}>
            <span className={k}>音色</span>
            <select id="voice" className={select} value={settings.voice} onChange={(e) => void patchSettings({ voice: e.target.value })}>
              {!voices.some((v) => v.id === settings.voice) && <option value={settings.voice}>{settings.voice}</option>}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className={k}>语速</span>
            <span className="flex items-center gap-2">
              <input
                id="rate"
                type="range"
                min={TTS_RATE_MIN}
                max={TTS_RATE_MAX}
                step={5}
                value={settings.rate}
                onChange={(e) => void patchSettings({ rate: Number(e.target.value) })}
                className="w-40"
              />
              <span className="text-fg-3 text-xs">{settings.rate}</span>
              <button className="text-xs px-2 py-1 rounded-md border border-line" onClick={() => void api.voice.speak('This is how I sound at this speed.')}>
                试听
              </button>
            </span>
            <span className={k}>自动朗读 AI 回复</span>
            <Toggle on={settings.autoSpeak} onChange={(v) => void patchSettings({ autoSpeak: v })} label="" />
          </div>
        </section>
```

- [ ] **Step 3: 手动验证**

Run: `npm run typecheck && npx eslint src/renderer/src/components/SettingsPage.tsx && npm run dev:fake`

Expected：
1. 二进制显示"已找到 /opt/homebrew/bin/whisper-cli"。
2. 把模型文件临时改名 → 显示"未下载"，点"下载"：进度条和 MB 数持续更新，"取消"可中断并显示"已取消下载"，`.part` 文件消失；再点"下载"跑完后显示"已下载 · 466 MB"（真实下载约 466 MB，网络允许时做一次；否则用改名回去的方式验证"已下载"状态即可，并在报告里说明）。
3. "删除"两次确认后文件消失、状态变"未下载"。
4. 音色下拉包含 Samantha、Daniel；"试听"用当前音色和语速朗读；切换音色和拖动语速后再试听有变化；自动朗读开关生效（Task 9 的流程）。
5. 回到聊天页，麦克风按钮状态随模型有无变化。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/SettingsPage.tsx
git commit -m "feat: 设置页语音区块（whisper 状态与模型下载、音色、语速、自动朗读）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 阶段 2 验收：真机闭环、权限路径、打包后麦克风

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-speakmate-design.md`（第 2 节追加验收结论）
- Modify（仅在需要时）：`electron-builder.yml` / `build/entitlements.mac.plist`

**Interfaces:**
- Consumes：前 10 个任务的全部成果；M1 的 `npm run build:unpack`。
- Produces：spec 第 2 节的阶段 2 验收记录；若打包后麦克风不可用，修正配置。

- [ ] **Step 1: 开发态完整闭环（真实 Claude）**

Run: `npm run dev`（真实 provider；每一步只做一次，控制调用次数）。

1. 新建"自由聊天"，等开场白朗读完（自动朗读开）。
2. 点麦克风说一句含错误的英文（例如 "Yesterday I goed to the supermarket and buyed some apple"），点 ■；记录：识别耗时、识别文本、置信度标记颜色。
3. 修正或直接回车发送；记录 AI 回复是否带纠错卡，朗读是否自动开始，"停止朗读"是否立即生效。
4. 朗读中直接点麦克风再说一句：朗读应停止、进入录音；发送后继续。
5. 录音到 60 秒自动结束并识别。
6. 退出应用前让一段朗读进行中，Cmd+Q：应用应正常退出（无残留 `say` 进程：`pgrep -x say` 为空）。

- [ ] **Step 2: 权限与异常路径**

1. 在"系统设置 → 隐私与安全性 → 麦克风"里关闭 my-tutor（或 Electron 开发态对应条目），回应用点麦克风：横幅提示权限被拒，"打开系统设置"按钮跳到麦克风隐私页；重新允许后可录音。
2. 录音中拔掉外接麦克风或在系统设置切换输入设备（若只有内置麦克风，跳过并说明）：横幅"麦克风已断开"，状态回 idle。
3. 把模型文件改名后点麦克风：按钮禁用、提示去设置页；改回后可用。
4. `whisper-cli` 路径改成不存在的（设置项 `whisperBinaryPath` 通过 Console `window.speakmate.settings.patch({ whisperBinaryPath: '/nope' })`）：同上提示；改回默认。

- [ ] **Step 3: 打包后麦克风**

```bash
npm run build:unpack
open dist/mac-arm64
```

在 Finder 里双击 `my-tutor.app`：首次点麦克风应弹 macOS 权限框（Info.plist 的 `NSMicrophoneUsageDescription` 文案可见），允许后能完成一次"录音 → 识别 → 发送 → 朗读"。若没有弹框或录音静默失败：检查 `dist/mac-arm64/my-tutor.app/Contents/Info.plist` 是否含 `NSMicrophoneUsageDescription`，`build/entitlements.mac.plist` 是否含 `com.apple.security.device.audio-input`，并确认 `electron-builder.yml` 的 `mac.entitlementsInherit` 指向它；修正后重新打包验证。打包后 `whisper-cli` 需从 `/opt/homebrew/bin` 找到（M1 的 `cleanEnv` 已补 PATH），若找不到，在设置页会显示"未找到"，记录原因。

- [ ] **Step 4: 写回 spec 第 2 节**

追加一行，格式：

```md
- 2026-MM-DD 阶段 2 验收：识别耗时 <N> s（<M> 秒录音）；置信度 <x>；纠错卡正常；自动朗读 / 停止 / 录音打断朗读正常；60 s 自动结束正常；权限拒绝引导正常；模型缺失提示正常；打包后麦克风权限弹框与闭环 <通过 / 问题与修复>；Cmd+Q 无残留 say 进程。问题：<无 / 列出>。
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs electron-builder.yml build
git commit -m "docs: 阶段 2 语音闭环验收结论

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完成标准（M2）

对照 spec 第 12 节阶段 2 验收："说英语 → 转写 → 修改 → AI 回答 → 朗读 → 停止，全程状态正确"，以及第 1.1 节第 4、5 条。错句本 / 生词本 / 学习画像属于阶段 3 计划。
