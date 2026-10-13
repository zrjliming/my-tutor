import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { stripMarkdownEmphasis } from '@shared/plain-text'
import type { TTSVoice } from '@shared/types'
import { cleanEnv } from '../ai/env'
import { TTSError, type TTSService } from './types'
import { tm } from '../i18n'

export interface MacSayOptions {
  spawnFn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
  sayPath?: string
  timeoutMs?: (text: string) => number
}

export function speakTimeoutMs(text: string): number {
  return Math.min(120_000, 10_000 + text.length * 80)
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', style: 'short' })
const regionName = (lang: string): string => {
  const region = lang.split('_')[1]
  return regionNames.of(region) ?? region
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
    // id 用 say 打印的完整名字：多语种音色（如 Eddy）只有带后缀才能选中英语变体
    const id = raw
    const key = `${id}\t${lang}`
    if (seen.has(key)) continue
    seen.add(key)
    const shortName = raw.replace(/\s*[(（].*$/, '').trim()
    const suffix = /[(（](.*)[)）]\s*$/.exec(raw)?.[1]
    // say 的后缀跟系统语言走，英文界面按语言代码自己拼，如 en_GB → English (UK)
    const label = suffix
      ? tm(`${shortName}（${suffix}）`, `${shortName} (English (${regionName(lang)}))`)
      : shortName
    voices.push({ id, label, lang })
  }
  return voices
}

export class MacSayService implements TTSService {
  private current: { child: ChildProcess; done: Promise<void> } | null = null
  // 每次 speak/stop 递增；speak 等完旧进程后若代数已变，说明被更新的 speak 或 stop 取代，不再 spawn
  private generation = 0
  private readonly spawnFn: typeof nodeSpawn
  private readonly sayPath: string
  private readonly timeoutFor: (text: string) => number

  constructor(private readonly opts: MacSayOptions = {}) {
    this.spawnFn = opts.spawnFn ?? nodeSpawn
    this.sayPath = opts.sayPath ?? 'say'
    this.timeoutFor = opts.timeoutMs ?? speakTimeoutMs
  }

  async speak(raw: string, { voice, rate }: { voice: string; rate: number }): Promise<void> {
    // 兜底：回复偶尔带 **加粗** 之类的 Markdown，不能把星号读出来
    const text = stripMarkdownEmphasis(raw)
    const gen = ++this.generation
    await this.stopCurrent()
    if (gen !== this.generation) return
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
        finish(new TTSError('timeout', tm('朗读超时，已中止', 'Speech timed out and was stopped')))
      }, this.timeoutFor(text))
      child.on('error', (e) =>
        finish(
          new TTSError(
            'failed',
            tm(`无法启动 say：${e.message}`, `Could not start say: ${e.message}`)
          )
        )
      )
      child.on('close', (code, sig) => {
        if (code === 0 || sig === 'SIGTERM') finish()
        else finish(new TTSError('failed', tm(`say 退出码 ${code}`, `say exit code ${code}`)))
      })
    })
    this.current = { child, done }
    child.stdin?.on('error', () => {}) // say 提前退出时写 stdin 会 EPIPE，结果以 close 为准
    child.stdin?.end(text)
    return done
  }

  async stop(): Promise<void> {
    this.generation++
    await this.stopCurrent()
  }

  private async stopCurrent(): Promise<void> {
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
