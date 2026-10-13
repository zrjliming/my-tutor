import { join } from 'node:path'
import type {
  AppSettings,
  SpeakOutcome,
  TranscribeOutcome,
  TTSVoice,
  VoiceStatus
} from '@shared/types'
import { DEFAULT_SETTINGS, WHISPER_MODEL_FILE } from '@shared/types'
import { ASRError, type SpeechRecognitionService } from '../asr/types'
import type { WhisperConfig } from '../asr/whisper-cli'
import { TTSError, type TTSService } from '../tts/types'
import type { ModelManager } from './model-manager'
import { tm } from '../i18n'

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
    if (this.transcribing)
      return {
        ok: false,
        kind: 'failed',
        message: tm('上一次识别尚未结束', 'The previous transcription is still running')
      }
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
