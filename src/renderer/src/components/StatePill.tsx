import type { UiState } from '../state/machine'

const STYLE: Record<UiState, string> = {
  idle: 'bg-surface-2 text-fg-2 border-line',
  recording: 'bg-bad-soft text-bad border-transparent',
  transcribing: 'bg-warn-soft text-warn border-transparent',
  awaiting_confirmation: 'bg-good-soft text-good border-transparent',
  sending: 'bg-warn-soft text-warn border-transparent',
  streaming: 'bg-warn-soft text-warn border-transparent',
  speaking: 'bg-good-soft text-good border-transparent',
  error: 'bg-bad-soft text-bad border-transparent'
}

export function StatePill({ state }: { state: UiState }): React.JSX.Element {
  return (
    <span className={`font-mono text-[11px] px-2 py-0.5 rounded border ${STYLE[state]}`}>
      {state}
    </span>
  )
}
