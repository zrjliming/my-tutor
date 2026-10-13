import { MAX_RECORDING_SECONDS } from '@shared/types'

export interface RecorderOptions {
  onTick?: (seconds: number) => void
  onError?: (message: string) => void
  maxSeconds?: number
  onAutoStop?: (reason: 'limit' | 'ended') => void
}

const TARGET_RATE = 16000

/** 启动期间被 cancel() 时 start() 抛出的错误；调用方应静默处理。 */
export function recordingCancelledError(): Error {
  const err = new Error('录音已取消')
  err.name = 'AbortError'
  return err
}

export const isRecordingCancelled = (e: unknown): boolean =>
  e instanceof Error && e.name === 'AbortError' && e.message === '录音已取消'

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
  private starting = false
  private cancelRequested = false
  private pending: Promise<Float32Array> | null = null

  constructor(private readonly opts: RecorderOptions = {}) {
    this.maxSeconds = opts.maxSeconds ?? MAX_RECORDING_SECONDS
  }

  get active(): boolean {
    return this.node !== null
  }

  async start(): Promise<void> {
    if (this.active || this.starting) throw new Error('已在录音')
    this.starting = true
    this.cancelRequested = false
    this.pending = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      let context: AudioContext | null = null
      try {
        // 每个 await 之后检查：启动期间被 cancel() 就释放已拿到的流与 AudioContext
        if (this.cancelRequested) throw recordingCancelledError()
        context = new AudioContext()
        await context.audioWorklet.addModule('./recorder-worklet.js')
        if (this.cancelRequested) throw recordingCancelledError()
        const source = context.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(context, 'recorder-processor')
        this.chunks = []
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          this.chunks.push(e.data)
        }
        source.connect(node)
        // 不连到 destination，避免回放到扬声器
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (this.stream !== stream) return
          this.opts.onError?.('麦克风已断开')
          this.finish('ended')
        })
        this.stream = stream
        this.context = context
        this.node = node
        this.seconds = 0
        this.timer = setInterval(() => {
          this.seconds += 1
          this.opts.onTick?.(this.seconds)
          if (this.seconds >= this.maxSeconds) this.finish('limit')
        }, 1000)
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop())
        void context?.close()
        throw err
      }
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<Float32Array> {
    if (this.active) return this.capture()
    const pending = this.pending
    this.pending = null
    return pending ?? new Float32Array(0)
  }

  cancel(): void {
    if (this.starting) this.cancelRequested = true
    this.pending = null
    this.release()
  }

  /** 内部停止（到时长上限或麦克风断开）：保留结果给下一次 stop()，再通知调用方。 */
  private finish(reason: 'limit' | 'ended'): void {
    if (!this.active) return
    const pending = this.capture()
    pending.catch(() => {}) // 拒绝留给 stop() 的调用方处理，这里只避免未处理的 rejection
    this.pending = pending
    this.opts.onAutoStop?.(reason)
  }

  private capture(): Promise<Float32Array> {
    const sourceRate = this.context?.sampleRate ?? TARGET_RATE
    const chunks = this.chunks
    this.release()
    // 定时器到点前可能多收了一点：截到上限，免得超过 IPC 的音频大小限制
    const max = MAX_RECORDING_SECONDS * TARGET_RATE
    return resampleTo16k(chunks, sourceRate).then((s) => (s.length > max ? s.slice(0, max) : s))
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
