export type UiState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'awaiting_confirmation'
  | 'sending'
  | 'streaming'
  | 'speaking'
  | 'error'
export type UiEvent =
  | 'SEND'
  | 'FIRST_DELTA'
  | 'DONE'
  | 'FAIL'
  | 'STOP'
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'TRANSCRIBED'
  | 'INPUT_CLEARED'
  | 'SPEAK'
  | 'SPEAK_END'
  | 'RESET'

const TABLE: Record<UiState, Partial<Record<UiEvent, UiState>>> = {
  idle: { SEND: 'sending', START_RECORDING: 'recording', SPEAK: 'speaking' },
  awaiting_confirmation: {
    SEND: 'sending',
    START_RECORDING: 'recording',
    INPUT_CLEARED: 'idle',
    SPEAK: 'speaking'
  },
  recording: { STOP_RECORDING: 'transcribing', FAIL: 'error', STOP: 'idle' },
  transcribing: { TRANSCRIBED: 'awaiting_confirmation', FAIL: 'error', STOP: 'idle' },
  sending: { FIRST_DELTA: 'streaming', DONE: 'idle', FAIL: 'error', STOP: 'idle' },
  streaming: { DONE: 'idle', FAIL: 'error', STOP: 'idle' },
  speaking: { SPEAK_END: 'idle', SEND: 'sending', START_RECORDING: 'recording', STOP: 'idle' },
  error: { RESET: 'idle', SEND: 'sending', START_RECORDING: 'recording' }
}

export function transition(state: UiState, event: UiEvent): UiState {
  return TABLE[state][event] ?? state
}

export const canSend = (s: UiState): boolean =>
  s === 'idle' || s === 'awaiting_confirmation' || s === 'speaking' || s === 'error'
export const canRecord = canSend
export const canSpeak = (s: UiState): boolean =>
  s === 'idle' || s === 'awaiting_confirmation' || s === 'speaking'
export const isBusy = (s: UiState): boolean => s === 'sending' || s === 'streaming'
