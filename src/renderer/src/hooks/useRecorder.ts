import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Recorder, recordingCancelledError } from '../lib/recorder'

export function useRecorder(opts: {
  onError: (message: string) => void
  onAutoStop?: (reason: 'limit' | 'ended') => void
}): {
  seconds: number
  start(): Promise<void>
  stop(): Promise<Float32Array>
  cancel(): void
} {
  const [seconds, setSeconds] = useState(0)
  const ref = useRef<Recorder | null>(null)
  const onErrorRef = useRef(opts.onError)
  const onAutoStopRef = useRef(opts.onAutoStop)
  // 回调存进 ref（提交后同步更新），Recorder 里拿到的总是最新的闭包
  useLayoutEffect(() => {
    onErrorRef.current = opts.onError
    onAutoStopRef.current = opts.onAutoStop
  })

  useEffect(
    () => () => {
      ref.current?.cancel()
      ref.current = null
    },
    []
  )

  const start = useCallback(async () => {
    ref.current?.cancel()
    setSeconds(0)
    const rec = new Recorder({
      onTick: setSeconds,
      onError: (m) => onErrorRef.current(m),
      onAutoStop: (reason) => onAutoStopRef.current?.(reason)
    })
    ref.current = rec
    await rec.start()
    // 启动期间被卸载或被新的 start/cancel 顶替：丢掉这次录音
    if (ref.current !== rec) {
      rec.cancel()
      throw recordingCancelledError()
    }
  }, [])

  const stop = useCallback(async () => {
    const rec = ref.current
    ref.current = null
    setSeconds(0)
    return rec ? rec.stop() : new Float32Array(0)
  }, [])

  const cancel = useCallback(() => {
    ref.current?.cancel()
    ref.current = null
    setSeconds(0)
  }, [])

  return { seconds, start, stop, cancel }
}
