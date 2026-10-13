import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelProgressEvent } from '@shared/types'
import { WHISPER_MODEL_URL } from '@shared/types'

export interface ModelManagerOptions {
  modelPath: () => string
  url?: string
  fetchFn?: typeof fetch
  onProgress: (e: ModelProgressEvent) => void
}

export class ModelManager {
  private inflight: { promise: Promise<void>; ac: AbortController } | null = null
  private readonly url: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly opts: ModelManagerOptions) {
    this.url = opts.url ?? WHISPER_MODEL_URL
    this.fetchFn = opts.fetchFn ?? fetch
  }

  status(): {
    modelPath: string
    modelFound: boolean
    modelBytes: number | null
    downloading: boolean
  } {
    const modelPath = this.opts.modelPath()
    let modelBytes: number | null = null
    try {
      const st = statSync(modelPath)
      if (st.isFile() && st.size > 0) modelBytes = st.size
    } catch {
      modelBytes = null
    }
    return {
      modelPath,
      modelFound: modelBytes !== null,
      modelBytes,
      downloading: this.inflight !== null
    }
  }

  download(): Promise<void> {
    if (this.inflight) return this.inflight.promise
    const ac = new AbortController()
    const promise = this.run(ac).finally(() => {
      this.inflight = null
    })
    this.inflight = { promise, ac }
    return promise
  }

  cancel(): void {
    this.inflight?.ac.abort()
  }

  delete(): void {
    this.cancel()
    const p = this.opts.modelPath()
    rmSync(p, { force: true })
    rmSync(`${p}.part`, { force: true })
  }

  private async run(ac: AbortController): Promise<void> {
    const modelPath = this.opts.modelPath()
    const partPath = `${modelPath}.part`
    let out: ReturnType<typeof createWriteStream> | null = null
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      mkdirSync(dirname(modelPath), { recursive: true })
      rmSync(partPath, { force: true })
      const res = await this.fetchFn(this.url, { signal: ac.signal })
      if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
      const totalHeader = res.headers.get('content-length')
      const total = totalHeader ? Number(totalHeader) : null
      out = createWriteStream(partPath)
      // 错误已经通过 write/end 回调抛给下面的 catch；不挂监听的话 'error' 事件会变成未捕获异常
      out.on('error', () => {})
      const body = res.body.getReader()
      reader = body
      // fetch 实现未必尊重 signal（测试里的假 fetch 就不），这里自己取消读取
      ac.signal.addEventListener('abort', () => void body.cancel().catch(() => {}), {
        once: true
      })
      let received = 0
      for (;;) {
        if (ac.signal.aborted) throw new Error('已取消')
        const { done, value } = await body.read()
        if (done) break
        received += value.byteLength
        await new Promise<void>((resolve, reject) =>
          out!.write(value, (e) => (e ? reject(e) : resolve()))
        )
        this.opts.onProgress({ type: 'progress', received, total })
      }
      await new Promise<void>((resolve) => out!.end(resolve))
      out = null
      if (ac.signal.aborted) throw new Error('已取消')
      if (total !== null && Number.isFinite(total) && received !== total) {
        throw new Error(`下载不完整：${received}/${total} 字节`)
      }
      renameSync(partPath, modelPath)
      this.opts.onProgress({ type: 'done' })
    } catch (e) {
      await reader?.cancel().catch(() => {})
      if (out) await new Promise<void>((resolve) => out!.end(resolve))
      try {
        rmSync(partPath, { force: true })
      } catch {
        // 清理失败（如 .part 是目录）不影响上报 error
      }
      if (ac.signal.aborted) this.opts.onProgress({ type: 'cancelled' })
      else this.opts.onProgress({ type: 'error', message: String((e as Error)?.message ?? e) })
    }
  }
}
