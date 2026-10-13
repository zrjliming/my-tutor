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
  it('keeps english voices, dedupes, labels the localized suffix', () => {
    expect(parseSayVoices(SAY_V)).toEqual([
      { id: 'Albert', label: 'Albert', lang: 'en_US' },
      { id: 'Daniel (英语（英国）)', label: 'Daniel（英语（英国））', lang: 'en_GB' },
      { id: 'Samantha (英语（美国）)', label: 'Samantha（英语（美国））', lang: 'en_US' }
    ])
  })
  it('keeps multi-locale english variants as distinct ids', () => {
    const out = `Eddy (德语（德国）)         de_DE    # Hallo! Ich heiße Eddy.
Eddy (英语（英国）)         en_GB    # Hello! My name is Eddy.
Eddy (英语（美国）)         en_US    # Hello! My name is Eddy.
`
    expect(parseSayVoices(out)).toEqual([
      { id: 'Eddy (英语（英国）)', label: 'Eddy（英语（英国））', lang: 'en_GB' },
      { id: 'Eddy (英语（美国）)', label: 'Eddy（英语（美国））', lang: 'en_US' }
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

function fakeSpawn(): {
  spawnFn: (...a: unknown[]) => FakeChild
  calls: Array<{ cmd: string; args: string[] }>
  children: FakeChild[]
} {
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
  it('two speak calls in the same tick spawn only the second', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p1 = tts.speak('one', { voice: 'Samantha', rate: 175 })
    const p2 = tts.speak('two', { voice: 'Samantha', rate: 175 })
    await expect(p1).resolves.toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(f.calls).toHaveLength(1)
    expect(f.children[0].written).toBe('two')
    f.children[0].emit('close', 0)
    await expect(p2).resolves.toBeUndefined()
  })
  it('speak immediately followed by stop spawns nothing', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never })
    const p = tts.speak('one', { voice: 'Samantha', rate: 175 })
    await tts.stop()
    await expect(p).resolves.toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(f.calls).toHaveLength(0)
  })
  it('times out a hung process with a TTSError', async () => {
    const f = fakeSpawn()
    const tts = new MacSayService({ spawnFn: f.spawnFn as never, timeoutMs: () => 30 })
    await expect(tts.speak('hang', { voice: 'Samantha', rate: 175 })).rejects.toMatchObject({
      kind: 'timeout'
    })
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
    expect((await p).map((v) => v.id)).toEqual([
      'Albert',
      'Daniel (英语（英国）)',
      'Samantha (英语（美国）)'
    ])
  })
})
