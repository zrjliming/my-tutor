import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { setMainLanguage } from '../i18n'
import { registerHandler, registerVoidHandler, type IpcHandleTarget } from './handle'

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>

function fakeIpc(): { ipc: IpcHandleTarget; handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>()
  const ipc = {
    handle: (channel: string, listener: Listener) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcHandleTarget
  return { ipc, handlers }
}

describe('registerHandler', () => {
  it('validates input and passes the parsed value', async () => {
    const { ipc, handlers } = fakeIpc()
    registerHandler(ipc, 'x', z.object({ n: z.number() }), (i) => i.n * 2)
    await expect(handlers.get('x')!({}, { n: 21 })).resolves.toBe(42)
    await expect(handlers.get('x')!({}, { n: 'no' })).rejects.toThrow(/参数无效（x）/)
  })
  it('校验细节跟随界面语言', async () => {
    const { ipc, handlers } = fakeIpc()
    registerHandler(ipc, 'x', z.object({ n: z.number() }), (i) => i.n)
    await expect(handlers.get('x')!({}, { n: 'no' })).rejects.toThrow(/无效输入/)
    setMainLanguage('en')
    try {
      await expect(handlers.get('x')!({}, { n: 'no' })).rejects.toThrow(/Invalid input/)
    } finally {
      setMainLanguage('zh')
    }
  })
  it('void handlers ignore arguments', async () => {
    const { ipc, handlers } = fakeIpc()
    registerVoidHandler(ipc, 'y', () => 'ok')
    await expect(handlers.get('y')!({}, 'junk')).resolves.toBe('ok')
  })
})
