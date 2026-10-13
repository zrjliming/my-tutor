import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelProgressEvent } from '@shared/types'
import { ModelManager } from './model-manager'

let dir: string
let modelPath: string
let events: ModelProgressEvent[]

const streamOf = (chunks: string[], delayMs = 0): ReadableStream<Uint8Array> =>
  new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        controller.enqueue(new TextEncoder().encode(c))
      }
      controller.close()
    }
  })

const okFetch =
  (chunks: string[], total: number | null = null, delayMs = 0): typeof fetch =>
  async () =>
    new Response(streamOf(chunks, delayMs), {
      status: 200,
      headers: total === null ? {} : { 'content-length': String(total) }
    })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-test-'))
  modelPath = join(dir, 'ggml-small.en.bin')
  events = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const mk = (fetchFn: typeof fetch): ModelManager =>
  new ModelManager({
    modelPath: () => modelPath,
    url: 'https://example/m.bin',
    fetchFn,
    onProgress: (e) => events.push(e)
  })

describe('ModelManager.status', () => {
  it('ignores .part and zero-byte files', () => {
    const m = mk(okFetch([]))
    expect(m.status()).toMatchObject({ modelFound: false, modelBytes: null, downloading: false })
    writeFileSync(`${modelPath}.part`, 'partial')
    expect(m.status().modelFound).toBe(false)
    writeFileSync(modelPath, '')
    expect(m.status().modelFound).toBe(false)
    writeFileSync(modelPath, 'abc')
    expect(m.status()).toMatchObject({ modelFound: true, modelBytes: 3 })
  })
})

describe('ModelManager.download', () => {
  it('streams to .part, renames on completion, reports progress and done', async () => {
    const m = mk(okFetch(['abc', 'def'], 6))
    await m.download()
    expect(readFileSync(modelPath, 'utf8')).toBe('abcdef')
    expect(existsSync(`${modelPath}.part`)).toBe(false)
    expect(events).toEqual([
      { type: 'progress', received: 3, total: 6 },
      { type: 'progress', received: 6, total: 6 },
      { type: 'done' }
    ])
  })
  it('reports error on non-2xx and leaves no model file', async () => {
    const m = mk(async () => new Response('nope', { status: 404 }))
    await m.download()
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('404') })
    expect(existsSync(modelPath)).toBe(false)
    expect(existsSync(`${modelPath}.part`)).toBe(false)
  })
  it('cancel aborts, removes .part and reports cancelled', async () => {
    const m = mk(okFetch(['a', 'b', 'c', 'd'], 4, 30))
    const p = m.download()
    await new Promise((r) => setTimeout(r, 45))
    expect(m.status().downloading).toBe(true)
    m.cancel()
    await p
    expect(events.at(-1)).toEqual({ type: 'cancelled' })
    expect(existsSync(`${modelPath}.part`)).toBe(false)
    expect(existsSync(modelPath)).toBe(false)
  })
  it('a second download while one is running returns the same promise', async () => {
    const m = mk(okFetch(['ab'], 2, 20))
    const p1 = m.download()
    const p2 = m.download()
    expect(p2).toBe(p1)
    await p1
  })
  it('reports error (no uncaught exception) when the .part file cannot be opened', async () => {
    const roDir = join(dir, 'ro')
    mkdirSync(roDir)
    chmodSync(roDir, 0o555)
    modelPath = join(roDir, 'ggml-small.en.bin')
    try {
      const m = mk(okFetch(['abc'], 3))
      await m.download()
      expect(events.at(-1)).toMatchObject({ type: 'error' })
      expect(existsSync(modelPath)).toBe(false)
      expect(m.status().downloading).toBe(false)
    } finally {
      chmodSync(roDir, 0o755)
    }
  })
  it('reports error (download never rejects) when the stale .part cannot be removed', async () => {
    mkdirSync(`${modelPath}.part`)
    const m = mk(okFetch(['abc'], 3))
    await expect(m.download()).resolves.toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(existsSync(modelPath)).toBe(false)
    expect(m.status().downloading).toBe(false)
  })
  it('reports error when the body is shorter than content-length', async () => {
    const m = mk(okFetch(['abc'], 10))
    await m.download()
    expect(events.at(-1)).toEqual({ type: 'error', message: '下载不完整：3/10 字节' })
    expect(existsSync(modelPath)).toBe(false)
    expect(existsSync(`${modelPath}.part`)).toBe(false)
  })
  it('delete removes the model and any .part', () => {
    const m = mk(okFetch([]))
    writeFileSync(modelPath, 'x')
    writeFileSync(`${modelPath}.part`, 'y')
    m.delete()
    expect(existsSync(modelPath)).toBe(false)
    expect(existsSync(`${modelPath}.part`)).toBe(false)
  })
})
