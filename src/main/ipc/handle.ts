import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'

export type IpcHandleTarget = Pick<IpcMain, 'handle'>

export function registerHandler<I, O>(
  ipc: IpcHandleTarget,
  channel: string,
  schema: ZodType<I>,
  fn: (input: I) => Promise<O> | O
): void {
  ipc.handle(channel, async (_event: IpcMainInvokeEvent, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      throw new Error(`参数无效（${channel}）：${detail}`)
    }
    return fn(parsed.data)
  })
}

export function registerVoidHandler<O>(
  ipc: IpcHandleTarget,
  channel: string,
  fn: () => Promise<O> | O
): void {
  ipc.handle(channel, async () => fn())
}
