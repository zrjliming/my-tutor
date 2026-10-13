import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildWhisperArgs, WhisperCliService } from './whisper-cli'

let dir: string
let fakeBin: string
let model: string
const wav = Buffer.alloc(100, 1)

function writeFakeBinary(body: string): void {
  writeFileSync(fakeBin, `#!/bin/sh\n${body}\n`)
  chmodSync(fakeBin, 0o755)
}

// 解析参数里的 -of <base>，写 <base>.json
const WRITE_JSON = `
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-of" ]; then out="$2"; fi
  shift
done
cat > "$out.json" <<'JSON'
{"transcription":[{"offsets":{"from":0,"to":1000},"text":" Hello there.","tokens":[{"text":"[_BEG_]","p":0.5},{"text":" Hello","p":0.9},{"text":" there.","p":0.7}]}]}
JSON
echo "some stdout noise"
`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'whisper-test-'))
  fakeBin = join(dir, 'whisper-cli')
  model = join(dir, 'ggml-small.en.bin')
  writeFileSync(model, 'model')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const svc = (
  extra: Partial<ConstructorParameters<typeof WhisperCliService>[0]> = {}
): WhisperCliService =>
  new WhisperCliService({
    getConfig: () => ({ binaryPath: fakeBin, modelPath: model }),
    tmpDir: dir,
    ...extra
  })

describe('buildWhisperArgs', () => {
  it('uses the verified flag set', () => {
    expect(buildWhisperArgs({ binaryPath: '/b', modelPath: '/m.bin' }, '/t/a.wav', '/t/a')).toEqual(
      ['-m', '/m.bin', '-f', '/t/a.wav', '-l', 'en', '-ojf', '-of', '/t/a', '-np']
    )
  })
})

describe('WhisperCliService', () => {
  it('isReady reports binary and model presence', async () => {
    writeFakeBinary(WRITE_JSON)
    expect(await svc().isReady()).toEqual({ binary: true, model: true })
    expect(
      await svc({
        getConfig: () => ({ binaryPath: '/nope/whisper-cli', modelPath: model })
      }).isReady()
    ).toEqual({ binary: false, model: true })
    expect(
      await svc({
        getConfig: () => ({ binaryPath: fakeBin, modelPath: join(dir, 'missing.bin') })
      }).isReady()
    ).toEqual({ binary: true, model: false })
  })
  it('transcribes via the JSON file (not stdout) and deletes temp files', async () => {
    writeFakeBinary(WRITE_JSON)
    const r = await svc().transcribe(wav, new AbortController().signal)
    expect(r.text).toBe('Hello there.')
    expect(r.confidence).toBeCloseTo(0.8)
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav') || f.endsWith('.json'))).toEqual([])
  })
  it('throws binary_missing / model_missing before spawning', async () => {
    writeFakeBinary(WRITE_JSON)
    await expect(
      svc({ getConfig: () => ({ binaryPath: '/nope/whisper-cli', modelPath: model }) }).transcribe(
        wav,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'binary_missing' })
    await expect(
      svc({ getConfig: () => ({ binaryPath: fakeBin, modelPath: '/nope.bin' }) }).transcribe(
        wav,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'model_missing' })
  })
  it('throws empty when the transcript has no text', async () => {
    writeFakeBinary(`
out=""
while [ $# -gt 0 ]; do if [ "$1" = "-of" ]; then out="$2"; fi; shift; done
echo '{"transcription":[{"offsets":{"from":0,"to":10},"text":"","tokens":[{"text":"[_BEG_]","p":0.9}]}]}' > "$out.json"`)
    await expect(svc().transcribe(wav, new AbortController().signal)).rejects.toMatchObject({
      kind: 'empty'
    })
  })
  it('throws failed when the process exits non-zero or writes no JSON', async () => {
    writeFakeBinary('echo "boom" >&2; exit 3')
    await expect(svc().transcribe(wav, new AbortController().signal)).rejects.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('boom')
    })
  })
  it('times out and kills a hung process', async () => {
    writeFakeBinary('sleep 5')
    const t0 = Date.now()
    await expect(
      svc({ timeoutMs: 200 }).transcribe(wav, new AbortController().signal)
    ).rejects.toMatchObject({ kind: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav'))).toEqual([])
  })
  it('aborts on signal and cleans up', async () => {
    writeFakeBinary('sleep 5')
    const ac = new AbortController()
    const p = svc().transcribe(wav, ac.signal)
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav'))).toEqual([])
  })
  it('rejects a second concurrent transcription', async () => {
    writeFakeBinary('sleep 1')
    const s = svc()
    const first = s.transcribe(wav, new AbortController().signal).catch(() => {})
    await expect(s.transcribe(wav, new AbortController().signal)).rejects.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('尚未结束')
    })
    await first
  })
})
