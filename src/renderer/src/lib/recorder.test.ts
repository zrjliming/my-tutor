import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Recorder, isRecordingCancelled } from './recorder'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let gum: ReturnType<typeof deferred<MediaStream>>
let addModule: ReturnType<typeof deferred<void>>
let track: { stop: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }
let contexts: { close: ReturnType<typeof vi.fn> }[]
let nodes: { port: { onmessage: ((e: { data: Float32Array }) => void) | null } }[]

beforeEach(() => {
  vi.useFakeTimers()
  gum = deferred<MediaStream>()
  addModule = deferred<void>()
  track = { stop: vi.fn(), addEventListener: vi.fn() }
  contexts = []
  nodes = []
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => gum.promise } })
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 16000
      audioWorklet = { addModule: () => addModule.promise }
      close = vi.fn(async () => {})
      constructor() {
        contexts.push(this)
      }
      createMediaStreamSource(): { connect: () => void } {
        return { connect: () => {} }
      }
    }
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null, close: () => {} }
      constructor() {
        nodes.push(this)
      }
      disconnect = vi.fn()
    }
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const stream = (): MediaStream =>
  ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream

describe('Recorder.cancel during start', () => {
  it('cancelled while waiting for getUserMedia: releases the stream and rejects with a cancel error', async () => {
    const onAutoStop = vi.fn()
    const rec = new Recorder({ onAutoStop })
    const started = rec.start()
    rec.cancel()
    gum.resolve(stream())
    addModule.resolve()
    const err = await started.catch((e: unknown) => e)
    expect(isRecordingCancelled(err)).toBe(true)
    expect(track.stop).toHaveBeenCalled()
    expect(rec.active).toBe(false)
    vi.advanceTimersByTime(70_000)
    expect(onAutoStop).not.toHaveBeenCalled()
  })
  it('cancelled while loading the worklet: releases stream and AudioContext, no timer', async () => {
    const onAutoStop = vi.fn()
    const rec = new Recorder({ onAutoStop })
    const started = rec.start()
    gum.resolve(stream())
    await vi.waitFor(() => expect(contexts).toHaveLength(1))
    rec.cancel()
    addModule.resolve()
    const err = await started.catch((e: unknown) => e)
    expect(isRecordingCancelled(err)).toBe(true)
    expect(track.stop).toHaveBeenCalled()
    expect(contexts[0].close).toHaveBeenCalled()
    expect(rec.active).toBe(false)
    vi.advanceTimersByTime(70_000)
    expect(onAutoStop).not.toHaveBeenCalled()
  })
  it('a normal start still records', async () => {
    const rec = new Recorder()
    const started = rec.start()
    gum.resolve(stream())
    addModule.resolve()
    await started
    expect(rec.active).toBe(true)
    rec.cancel()
    expect(track.stop).toHaveBeenCalled()
  })
})

describe('Recorder.stop', () => {
  it('never returns more than 60 s of 16 kHz samples', async () => {
    const rec = new Recorder()
    const started = rec.start()
    gum.resolve(stream())
    addModule.resolve()
    await started
    for (let i = 0; i < 61; i++) nodes[0].port.onmessage?.({ data: new Float32Array(16000) })
    const samples = await rec.stop()
    expect(samples.length).toBe(60 * 16000)
  })
})
