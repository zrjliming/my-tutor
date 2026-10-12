import { describe, it, expect } from 'vitest'
import { transition, canSend, canRecord, isBusy } from './machine'

describe('transition', () => {
  it('walks the happy text path', () => {
    expect(transition('idle', 'SEND')).toBe('sending')
    expect(transition('sending', 'FIRST_DELTA')).toBe('streaming')
    expect(transition('streaming', 'DONE')).toBe('idle')
    expect(transition('idle', 'SPEAK')).toBe('speaking')
    expect(transition('speaking', 'SPEAK_END')).toBe('idle')
  })
  it('walks the voice path', () => {
    expect(transition('idle', 'START_RECORDING')).toBe('recording')
    expect(transition('recording', 'STOP_RECORDING')).toBe('transcribing')
    expect(transition('transcribing', 'TRANSCRIBED')).toBe('awaiting_confirmation')
    expect(transition('awaiting_confirmation', 'SEND')).toBe('sending')
    expect(transition('awaiting_confirmation', 'INPUT_CLEARED')).toBe('idle')
  })
  it('ignores illegal events', () => {
    expect(transition('transcribing', 'START_RECORDING')).toBe('transcribing')
    expect(transition('streaming', 'SEND')).toBe('streaming')
    expect(transition('recording', 'SEND')).toBe('recording')
    expect(transition('idle', 'DONE')).toBe('idle')
  })
  it('stop and failure', () => {
    expect(transition('streaming', 'STOP')).toBe('idle')
    expect(transition('sending', 'FAIL')).toBe('error')
    expect(transition('error', 'RESET')).toBe('idle')
    expect(transition('error', 'SEND')).toBe('sending')
    expect(transition('speaking', 'SEND')).toBe('sending')
    expect(transition('speaking', 'START_RECORDING')).toBe('recording')
  })
  it('guards', () => {
    expect(canSend('idle')).toBe(true)
    expect(canSend('streaming')).toBe(false)
    expect(canRecord('transcribing')).toBe(false)
    expect(isBusy('sending')).toBe(true)
    expect(isBusy('speaking')).toBe(false)
  })
})
