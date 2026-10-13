import { describe, it, expect } from 'vitest'
import { parseWhisperJson } from './whisper-json'

// 与 scripts/probe-whisper.sh 在本机实测的 -ojf 输出结构一致（节选）
const sample = {
  systeminfo: 'x',
  model: { type: 'small' },
  params: { model: 'ggml-small.en.bin', language: 'en' },
  result: { language: 'en' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:03,400' },
      offsets: { from: 0, to: 3400 },
      text: ' I went to the airport yesterday',
      tokens: [
        {
          text: '[_BEG_]',
          timestamps: { from: '00:00:00,000', to: '00:00:00,000' },
          offsets: { from: 0, to: 0 },
          id: 50363,
          p: 0.99
        },
        { text: ' I', offsets: { from: 0, to: 200 }, id: 314, p: 0.98 },
        { text: ' went', offsets: { from: 200, to: 500 }, id: 1816, p: 0.97 },
        { text: ' to', offsets: { from: 500, to: 600 }, id: 284, p: 0.99 },
        { text: ' the', offsets: { from: 600, to: 700 }, id: 262, p: 0.96 },
        { text: ' airport', offsets: { from: 700, to: 1200 }, id: 9003, p: 0.95 },
        { text: ' yesterday', offsets: { from: 1200, to: 1800 }, id: 7415, p: 0.9 },
        { text: '[_TT_164]', offsets: { from: 3400, to: 3400 }, id: 50527, p: 0.11 }
      ]
    },
    {
      timestamps: { from: '00:00:03,400', to: '00:00:05,000' },
      offsets: { from: 3400, to: 5000 },
      text: ' and bought a ticket.',
      tokens: [
        { text: ' and', offsets: { from: 3400, to: 3500 }, id: 1, p: 0.9 },
        { text: ' bought', offsets: { from: 3500, to: 3900 }, id: 2, p: 0.8 },
        { text: ' a', offsets: { from: 3900, to: 4000 }, id: 3, p: 0.9 },
        { text: ' ticket.', offsets: { from: 4000, to: 5000 }, id: 4, p: 0.8 }
      ]
    }
  ]
}

describe('parseWhisperJson', () => {
  it('joins segment text, keeps offsets, and averages p over non-special tokens', () => {
    const r = parseWhisperJson(sample)
    expect(r.text).toBe('I went to the airport yesterday and bought a ticket.')
    expect(r.segments).toEqual([
      { text: 'I went to the airport yesterday', startMs: 0, endMs: 3400 },
      { text: 'and bought a ticket.', startMs: 3400, endMs: 5000 }
    ])
    // 10 个普通 token：(0.98+0.97+0.99+0.96+0.95+0.9+0.9+0.8+0.9+0.8)/10 = 0.915；[_BEG_] 与 [_TT_164] 被过滤
    expect(r.confidence).toBeCloseTo(0.915, 3)
  })
  it('returns empty text and zero confidence when only special tokens exist', () => {
    const r = parseWhisperJson({
      transcription: [
        { offsets: { from: 0, to: 100 }, text: '', tokens: [{ text: '[_BEG_]', p: 0.9 }] }
      ]
    })
    expect(r.text).toBe('')
    expect(r.confidence).toBe(0)
    expect(r.segments).toEqual([])
  })
  it('tolerates missing tokens (-oj output) with confidence 0', () => {
    const r = parseWhisperJson({
      transcription: [{ offsets: { from: 0, to: 900 }, text: ' Hello.' }]
    })
    expect(r).toEqual({
      text: 'Hello.',
      confidence: 0,
      segments: [{ text: 'Hello.', startMs: 0, endMs: 900 }]
    })
  })
  it('drops segments that are only a non-speech annotation, and their tokens', () => {
    const r = parseWhisperJson({
      transcription: [
        {
          offsets: { from: 0, to: 2000 },
          text: ' (water running)',
          tokens: [
            { text: ' (', p: 0.2 },
            { text: 'water running', p: 0.3 },
            { text: ')', p: 0.4 }
          ]
        },
        {
          offsets: { from: 2000, to: 3000 },
          text: ' Hello.',
          tokens: [{ text: ' Hello.', p: 0.9 }]
        },
        {
          offsets: { from: 3000, to: 4000 },
          text: ' [BLANK_AUDIO]',
          tokens: [{ text: ' [BLANK_AUDIO]', p: 0.1 }]
        }
      ]
    })
    expect(r).toEqual({
      text: 'Hello.',
      confidence: 0.9,
      segments: [{ text: 'Hello.', startMs: 2000, endMs: 3000 }]
    })
  })
  it('returns empty text when every segment is a non-speech annotation', () => {
    const r = parseWhisperJson({
      transcription: [
        { offsets: { from: 0, to: 2000 }, text: ' [BLANK_AUDIO]', tokens: [{ text: 'x', p: 0.5 }] },
        { offsets: { from: 2000, to: 4000 }, text: ' (wind blowing)' }
      ]
    })
    expect(r).toEqual({ text: '', confidence: 0, segments: [] })
  })
  it('throws on malformed input', () => {
    expect(() => parseWhisperJson(null)).toThrow(/transcription/)
    expect(() => parseWhisperJson({ transcription: 'nope' })).toThrow(/transcription/)
  })
})
