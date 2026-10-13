import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { TTSVoice } from '@shared/types'
import { cleanEnv } from '../ai/env'
import { TTSError, type TTSService } from './types'

export interface MacSayOptions {
  spawnFn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
  sayPath?: string
  timeoutMs?: (text: string) => number
}

export function speakTimeoutMs(text: string): number {
  return Math.min(120_000, 10_000 + text.length * 80)
}

export function parseSayVoices(output: string): TTSVoice[] {
  const seen = new Set<string>()
  const voices: TTSVoice[] = []
  for (const line of output.split('\n')) {
    const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/.exec(line)
    if (!m) continue
    const raw = m[1].trim()
    const lang = m[2]
    if (!lang.startsWith('en_')) continue
    const id = raw.replace(/\s*[(（].*$/, '').trim()
    if (seen.has(id)) continue
    seen.add(id)
    const suffix = /[(（](.*)[)）]\s*$/.exec(raw)?.[1]
    voices.push({ id, label: suffix ? `${id}（${suffix}）` : id, lang })
  }
  return voices
}

export class MacSayService implements TTSService {
  private current: { child: ChildProcess; done: Promise<void> } | null = null
  private readonly spawnFn: typeof nodeSpawn
  private readonly sayPath: string
  private readonly timeoutFor: (text: string) => number

  constructor(private readonly opts: MacSayOptions = {}) {
    this.spawnFn = opts.spawnFn ?? nodeSpawn
    this.sayPath = opts.sayPath ?? 'say'
    this.timeoutFor = opts.timeoutMs ?? speakTimeoutMs
  }

  async speak(text: string, { voice, rate }: { voice: string; rate: number }): Promise<void> {
    await this.stop()
    const child = this.spawnFn(this.sayPath, ['-v', voice, '-r', String(rate)], {
      env: cleanEnv(this.opts.env ?? process.env),
      stdio: ['pipe', 'ignore', 'ignore']
    })
    const done = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: TTSError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.current?.child === child) this.current = null
        if (err) reject(err)
        else resolve()
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已退出
        }
        finish(new TTSError('timeout', '朗读超时，已中止'))
      }, this.timeoutFor(text))
      child.on('error', (e) => finish(new TTSError('failed', `无法启动 say：${e.message}`)))
      child.on('close', (code, sig) => {
        if (code === 0 || sig === 'SIGTERM') finish()
        else finish(new TTSError('failed', `say 退出码 ${code}`))
      })
    })
    this.current = { child, done }
    child.stdin?.end(text)
    return done
  }

  async stop(): Promise<void> {
    const cur = this.current
    if (!cur) return
    try {
      cur.child.kill('SIGTERM')
    } catch {
      // 已退出
    }
    await cur.done.catch(() => {})
  }

  listVoices(): Promise<TTSVoice[]> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.sayPath, ['-v', '?'], {
        env: cleanEnv(this.opts.env ?? process.env),
        stdio: ['ignore', 'pipe', 'ignore']
      })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
      child.on('error', (e) => reject(new TTSError('failed', e.message)))
      child.on('close', () => resolve(parseSayVoices(out)))
    })
  }
}
