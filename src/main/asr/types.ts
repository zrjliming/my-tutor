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
