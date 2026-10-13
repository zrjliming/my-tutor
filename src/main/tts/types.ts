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
