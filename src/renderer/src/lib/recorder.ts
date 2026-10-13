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
