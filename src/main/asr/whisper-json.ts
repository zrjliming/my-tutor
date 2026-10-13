import type { ASRResult } from '@shared/types'
import { tm } from '../i18n'

interface Token {
  text?: unknown
  p?: unknown
}
interface Segment {
  text?: unknown
  offsets?: { from?: unknown; to?: unknown }
  tokens?: unknown
}

const isSpecial = (text: string): boolean => text.trim().startsWith('[_')
// 整段只是非语音标注，如 (water running)、[BLANK_AUDIO]
const isAnnotation = (text: string): boolean => /^[[(][^\])]*[\])]$/.test(text)

export function parseWhisperJson(json: unknown): ASRResult {
  const root = json as { transcription?: unknown } | null
  if (!root || !Array.isArray(root.transcription)) {
    throw new Error(
      tm('whisper JSON 缺少 transcription 数组', 'whisper JSON has no transcription array')
    )
  }
  const segments: ASRResult['segments'] = []
  const probs: number[] = []
  for (const raw of root.transcription as Segment[]) {
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const startMs = typeof raw.offsets?.from === 'number' ? raw.offsets.from : 0
    const endMs = typeof raw.offsets?.to === 'number' ? raw.offsets.to : startMs
    if (isAnnotation(text)) continue
    if (text) segments.push({ text, startMs, endMs })
    if (Array.isArray(raw.tokens)) {
      for (const t of raw.tokens as Token[]) {
        if (typeof t.text !== 'string' || typeof t.p !== 'number') continue
        if (isSpecial(t.text)) continue
        probs.push(t.p)
      }
    }
  }
  const text = segments
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const confidence = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0
  return { text, confidence: text ? confidence : 0, segments }
}
