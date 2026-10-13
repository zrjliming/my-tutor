import { describe, it, expect } from 'vitest'
import { encodeWav16, rms, isSilent } from './wav'

const readU32 = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset).getUint32(o, true)
const readU16 = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset).getUint16(o, true)
const readI16 = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset).getInt16(o, true)
const ascii = (b: Uint8Array, o: number, n: number): string =>
  String.fromCharCode(...b.subarray(o, o + n))

describe('encodeWav16', () => {
  it('writes a canonical 44-byte PCM header for 16 kHz mono', () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000)
    expect(wav.byteLength).toBe(44 + 5 * 2)
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(readU32(wav, 4)).toBe(36 + 10)
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 12, 4)).toBe('fmt ')
    expect(readU32(wav, 16)).toBe(16)
    expect(readU16(wav, 20)).toBe(1) // PCM
    expect(readU16(wav, 22)).toBe(1) // mono
    expect(readU32(wav, 24)).toBe(16000)
    expect(readU32(wav, 28)).toBe(32000) // byte rate
    expect(readU16(wav, 32)).toBe(2) // block align
    expect(readU16(wav, 34)).toBe(16) // bits
    expect(ascii(wav, 36, 4)).toBe('data')
    expect(readU32(wav, 40)).toBe(10)
  })
  it('scales and clamps samples to int16', () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 1.5, -1.5]), 16000)
    expect(readI16(wav, 44)).toBe(0)
    expect(readI16(wav, 46)).toBe(16383)
    expect(readI16(wav, 48)).toBe(-16384)
    expect(readI16(wav, 50)).toBe(32767)
    expect(readI16(wav, 52)).toBe(-32768)
  })
})

describe('rms / isSilent', () => {
  it('computes rms and flags near-silence', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(isSilent(new Float32Array(1600).fill(0.001))).toBe(true)
    expect(isSilent(new Float32Array(1600).fill(0.05))).toBe(false)
    expect(isSilent(new Float32Array(0))).toBe(true)
  })
})
