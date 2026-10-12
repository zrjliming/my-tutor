import { describe, it, expect } from 'vitest'
import { SettingsPatchSchema, SpeakInputSchema, TranscribeInputSchema } from './schemas'
import { MAX_WAV_BYTES } from './types'

describe('TranscribeInputSchema', () => {
  it('accepts a Uint8Array within the size limit', () => {
    expect(TranscribeInputSchema.safeParse({ wav: new Uint8Array(45) }).success).toBe(true)
  })
  it('rejects oversized audio and non-binary input', () => {
    expect(
      TranscribeInputSchema.safeParse({ wav: new Uint8Array(MAX_WAV_BYTES + 1) }).success
    ).toBe(false)
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
      SettingsPatchSchema.safeParse({
        voice: 'Daniel',
        rate: 200,
        whisperBinaryPath: '/opt/homebrew/bin/whisper-cli',
        whisperModelPath: ''
      }).success
    ).toBe(true)
  })
  it('rejects out-of-range rate and non-integer rate', () => {
    expect(SettingsPatchSchema.safeParse({ rate: 99 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ rate: 301 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ rate: 150.5 }).success).toBe(false)
  })
})
