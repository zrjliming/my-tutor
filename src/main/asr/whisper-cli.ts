import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ASRResult } from '@shared/types'
import { cleanEnv } from '../ai/env'
import { ASRError, type SpeechRecognitionService } from './types'
import { parseWhisperJson } from './whisper-json'
import { tm } from '../i18n'

export interface WhisperConfig {
  binaryPath: string
  modelPath: string
}

export interface WhisperCliOptions {
  getConfig: () => WhisperConfig
  tmpDir: string
  timeoutMs?: number
  spawnFn?: typeof nodeSpawn
  env?: NodeJS.ProcessEnv
}

export function buildWhisperArgs(cfg: WhisperConfig, wavPath: string, outBase: string): string[] {
  return ['-m', cfg.modelPath, '-f', wavPath, '-l', 'en', '-ojf', '-of', outBase, '-np']
}

const fileExists = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export class WhisperCliService implements SpeechRecognitionService {
  private busy = false
  private readonly spawnFn: typeof nodeSpawn
  private readonly timeoutMs: number

  constructor(private readonly opts: WhisperCliOptions) {
    this.spawnFn = opts.spawnFn ?? nodeSpawn
    this.timeoutMs = opts.timeoutMs ?? 60_000
  }

  async isReady(): Promise<{ binary: boolean; model: boolean }> {
    const cfg = this.opts.getConfig()
    return { binary: fileExists(cfg.binaryPath), model: fileExists(cfg.modelPath) }
  }

  async transcribe(wav: Buffer, signal: AbortSignal): Promise<ASRResult> {
    if (this.busy)
      throw new ASRError(
        'failed',
        tm('上一次识别尚未结束', 'The previous transcription is still running')
      )
    const cfg = this.opts.getConfig()
    if (!fileExists(cfg.binaryPath))
      throw new ASRError(
        'binary_missing',
        tm(`找不到 whisper-cli：${cfg.binaryPath}`, `whisper-cli not found: ${cfg.binaryPath}`)
      )
    if (!fileExists(cfg.modelPath))
      throw new ASRError(
        'model_missing',
        tm(`找不到模型文件：${cfg.modelPath}`, `Model file not found: ${cfg.modelPath}`)
      )
    if (signal.aborted) throw new ASRError('aborted', tm('已取消', 'Cancelled'))

    this.busy = true
    const base = join(this.opts.tmpDir, `asr-${randomUUID()}`)
    const wavPath = `${base}.wav`
    const jsonPath = `${base}.json`
    try {
      writeFileSync(wavPath, wav)
      await this.runProcess(cfg, wavPath, base, signal)
      if (!existsSync(jsonPath))
        throw new ASRError(
          'failed',
          tm('whisper 没有产生 JSON 输出', 'whisper produced no JSON output')
        )
      const result = parseWhisperJson(JSON.parse(readFileSync(jsonPath, 'utf8')))
      if (!result.text) throw new ASRError('empty', tm('没识别出内容', 'Nothing was recognized'))
      return result
    } finally {
      rmSync(wavPath, { force: true })
      rmSync(jsonPath, { force: true })
      this.busy = false
    }
  }

  private runProcess(
    cfg: WhisperConfig,
    wavPath: string,
    base: string,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(cfg.binaryPath, buildWhisperArgs(cfg, wavPath, base), {
        env: cleanEnv(this.opts.env ?? process.env),
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let stderr = ''
      let settled = false
      const finish = (err?: ASRError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else resolve()
      }
      const kill = (): void => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已退出
        }
      }
      const onAbort = (): void => {
        kill()
        finish(new ASRError('aborted', tm('已取消', 'Cancelled')))
      }
      const timer = setTimeout(() => {
        kill()
        finish(
          new ASRError(
            'timeout',
            tm(
              `识别超过 ${Math.round(this.timeoutMs / 1000)} 秒，已中止`,
              `Transcription took over ${Math.round(this.timeoutMs / 1000)} s and was stopped`
            )
          )
        )
      }, this.timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (e) =>
        finish(
          new ASRError(
            'failed',
            tm(`无法启动 whisper-cli：${e.message}`, `Could not start whisper-cli: ${e.message}`)
          )
        )
      )
      child.on('close', (code) => {
        if (code === 0) finish()
        else
          finish(
            new ASRError(
              'failed',
              tm(`whisper-cli 退出码 ${code}：`, `whisper-cli exit code ${code}: `) +
                stderr.trim().slice(-400)
            )
          )
      })
    })
  }
}
