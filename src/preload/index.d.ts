import type { SpeakMateAPI } from '../shared/ipc'

declare global {
  interface Window {
    speakmate: SpeakMateAPI
  }
}

export {}
