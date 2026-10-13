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
    status: () => ({
      modelPath: '/m/ggml-small.en.bin',
      modelFound: found,
      modelBytes: found ? 10 : null,
      downloading: false
    }),
    download: async () => {},
    cancel: () => {},
    delete: () => {}
  }) as unknown as ModelManager

const mk = (
  asr: SpeechRecognitionService = new FakeASR(),
  tts: TTSService = new FakeTTS(),
  models = fakeModels()
): VoiceService =>
  new VoiceService({
    asr,
    tts,
    models,
    getSettings: () => ({ ...DEFAULT_SETTINGS, voice: 'Daniel', rate: 190 }),
    resolveConfig: () => ({
      binaryPath: '/opt/homebrew/bin/whisper-cli',
      modelPath: '/m/ggml-small.en.bin'
    })
  })

describe('resolveWhisperConfig', () => {
  it('falls back to defaults and the models dir', () => {
    expect(
      resolveWhisperConfig(
        { ...DEFAULT_SETTINGS, whisperBinaryPath: '', whisperModelPath: '' },
        '/ud/models'
      )
    ).toEqual({
      binaryPath: '/opt/homebrew/bin/whisper-cli',
      modelPath: '/ud/models/ggml-small.en.bin'
    })
    expect(
      resolveWhisperConfig(
        { ...DEFAULT_SETTINGS, whisperBinaryPath: '/x/whisper', whisperModelPath: '/y/m.bin' },
        '/ud/models'
      )
    ).toEqual({
      binaryPath: '/x/whisper',
      modelPath: '/y/m.bin'
    })
  })
})

describe('VoiceService', () => {
  it('status merges binary, model and download state', async () => {
    const s = await mk().status()
    expect(s).toMatchObject({
      binaryPath: '/opt/homebrew/bin/whisper-cli',
      binaryFound: true,
      modelFound: true,
      modelBytes: 10,
      downloading: false
    })
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
    expect(await svc.transcribe(new Uint8Array(100))).toMatchObject({
      ok: false,
      kind: 'failed',
      message: expect.stringContaining('尚未结束')
    })
    svc.cancelTranscribe()
    expect(await first).toMatchObject({ ok: false, kind: 'aborted' })
  })
  it('speak uses the configured voice and rate and reports failures', async () => {
    const tts = new FakeTTS()
    expect(await mk(new FakeASR(), tts).speak('Hi there')).toEqual({ ok: true })
    expect(tts.spoken).toEqual([{ text: 'Hi there', voice: 'Daniel', rate: 190 }])
    expect(await mk(new FakeASR(), new FakeTTS(true)).speak('x')).toEqual({
      ok: false,
      kind: 'failed',
      message: 'say 退出码 1'
    })
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
