import { useEffect, useState } from 'react'
import type { AICheckResult, ModelProgressEvent, TTSVoice, VoiceStatus } from '@shared/types'
import { DEFAULT_SETTINGS, TTS_RATE_MAX, TTS_RATE_MIN } from '@shared/types'
import { api } from '../api'
import { useChat } from '../store/ChatStore'

function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      className="inline-flex items-center gap-2"
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <span
        className={`w-[34px] h-5 rounded-full relative transition-colors ${on ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-0.5'}`}
        />
      </span>
      <span>
        {label}
        {on ? '开' : '关'}
      </span>
    </button>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { settings, patchSettings } = useChat()
  const [check, setCheck] = useState<AICheckResult | 'checking' | null>(null)
  const runCheck = async (): Promise<void> => {
    setCheck('checking')
    setCheck(await api.ai.check())
  }
  const [voice, setVoice] = useState<VoiceStatus | null>(null)
  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [confirmDeleteModel, setConfirmDeleteModel] = useState(false)
  const [dataDir, setDataDir] = useState<string | null>(null)

  const refreshVoice = async (): Promise<void> => setVoice(await api.voice.status())

  useEffect(() => {
    void api.app.dataDir().then(setDataDir)
    void api.voice.status().then(setVoice)
    void api.voice
      .listVoices()
      .then(setVoices)
      .catch(() => setVoices([]))
    return api.voice.onModelProgress((e: ModelProgressEvent) => {
      if (e.type === 'progress') setProgress({ received: e.received, total: e.total })
      else {
        setProgress(null)
        if (e.type === 'error') setVoiceError(e.message)
        if (e.type === 'cancelled') setVoiceError('已取消下载')
        void refreshVoice()
      }
    })
  }, [])

  const startDownload = (): void => {
    setVoiceError(null)
    setProgress({ received: 0, total: null })
    void api.voice.downloadModel().then(refreshVoice)
  }
  const deleteModel = async (): Promise<void> => {
    if (!confirmDeleteModel) {
      setConfirmDeleteModel(true)
      setTimeout(() => setConfirmDeleteModel(false), 2500)
      return
    }
    setConfirmDeleteModel(false)
    await api.voice.deleteModel()
    await refreshVoice()
  }
  const saveBinaryPath = async (value: string): Promise<void> => {
    const v = value.trim()
    if (v === settings.whisperBinaryPath) return
    await patchSettings({ whisperBinaryPath: v })
    await refreshVoice()
  }
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`
  const card = 'border border-line rounded-lg px-4 py-3.5 flex flex-col gap-2'
  const kv = 'grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 items-center'
  const k = 'text-fg-2 text-[12.5px]'
  const select = 'rounded-md border border-line bg-surface px-2 py-1'

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold">设置</h2>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3.5 max-w-[720px]">
        <section className={card}>
          <h3 className="text-sm font-semibold">Claude 连接</h3>
          <div className={kv}>
            <span className={k}>模型</span>
            <select
              id="model"
              className={select}
              value={settings.model}
              onChange={(e) => void patchSettings({ model: e.target.value })}
            >
              <option value="">账号默认</option>
              <option value="sonnet">sonnet</option>
              <option value="opus">opus</option>
            </select>
            <span className={k}></span>
            <span className="flex items-center gap-2">
              <button
                className="text-xs px-2 py-1 rounded-md border border-line"
                onClick={() => void runCheck()}
                disabled={check === 'checking'}
              >
                检测连接
              </button>
              {check === 'checking' && <span className="text-fg-3 text-xs">检测中…</span>}
              {check && check !== 'checking' && (
                <span className={`text-xs ${check.ok ? 'text-good' : 'text-bad'}`}>
                  {check.ok
                    ? `连接正常 · ${check.model ?? ''} · ${check.durationMs ?? 0} ms`
                    : `失败：${check.message}`}
                </span>
              )}
            </span>
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">学习</h3>
          <div className={kv}>
            <span className={k}>难度</span>
            <select
              id="difficulty"
              className={select}
              value={settings.difficulty}
              onChange={(e) =>
                void patchSettings({ difficulty: e.target.value as typeof settings.difficulty })
              }
            >
              <option value="beginner">初级</option>
              <option value="intermediate">中级</option>
              <option value="advanced">高级</option>
            </select>
            <span className={k}>中文解释</span>
            <Toggle
              on={settings.chineseExplanations}
              onChange={(v) => void patchSettings({ chineseExplanations: v })}
              label=""
            />
          </div>
          <p className="text-xs text-fg-3 m-0">难度和中文解释对新建的会话生效。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">语音识别（whisper.cpp）</h3>
          <div className={kv}>
            <span className={k}>whisper-cli 路径</span>
            <input
              id="whisperBinaryPath"
              key={settings.whisperBinaryPath}
              className={`${select} font-mono text-xs`}
              defaultValue={settings.whisperBinaryPath}
              placeholder={`留空使用 ${DEFAULT_SETTINGS.whisperBinaryPath}`}
              spellCheck={false}
              onBlur={(e) => void saveBinaryPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            <span className={k}>二进制</span>
            <span>
              {voice === null ? (
                <span className="text-fg-3">检查中…</span>
              ) : voice.binaryFound ? (
                <>
                  <span className="text-good">● 已找到</span>{' '}
                  <span className="text-fg-3">{voice.binaryPath}</span>
                </>
              ) : (
                <>
                  <span className="text-bad">● 未找到</span>{' '}
                  <span className="text-fg-3">
                    {voice.binaryPath}，请在终端运行 brew install whisper.cpp
                  </span>
                </>
              )}
            </span>
            <span className={k}>模型</span>
            <span className="flex items-center gap-2 flex-wrap">
              {voice === null ? (
                <span className="text-fg-3">检查中…</span>
              ) : voice.modelFound ? (
                <>
                  <span className="text-good">● 已下载</span>
                  <span className="text-fg-3">ggml-small.en.bin · {mb(voice.modelBytes ?? 0)}</span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line text-bad"
                    onClick={() => void deleteModel()}
                  >
                    {confirmDeleteModel ? '确认删除？' : '删除'}
                  </button>
                </>
              ) : progress ? (
                <>
                  <span className="text-fg-2">
                    下载中 {mb(progress.received)}
                    {progress.total ? ` / ${mb(progress.total)}` : ''}
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line"
                    onClick={() => void api.voice.cancelDownload()}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="text-bad">● 未下载</span>
                  <span className="text-fg-3">ggml-small.en.bin · 约 466 MB</span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line"
                    onClick={startDownload}
                  >
                    下载
                  </button>
                </>
              )}
            </span>
            {progress && (
              <>
                <span className={k}></span>
                <span className="h-1.5 rounded bg-line overflow-hidden block w-full">
                  <span
                    className="block h-full bg-accent"
                    style={{
                      width: progress.total
                        ? `${Math.min(100, (progress.received / progress.total) * 100)}%`
                        : '10%'
                    }}
                  />
                </span>
              </>
            )}
          </div>
          {voiceError && <p className="text-xs text-bad m-0">{voiceError}</p>}
          <p className="text-xs text-fg-3 m-0">录音只在本机识别，识别完成后立即删除，不会上传。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">朗读</h3>
          <div className={kv}>
            <span className={k}>音色</span>
            <select
              id="voice"
              className={select}
              value={settings.voice}
              onChange={(e) => void patchSettings({ voice: e.target.value })}
            >
              {!voices.some((v) => v.id === settings.voice) && (
                <option value={settings.voice}>{settings.voice}（当前）</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className={k}>语速</span>
            <span className="flex items-center gap-2">
              <input
                id="rate"
                type="range"
                min={TTS_RATE_MIN}
                max={TTS_RATE_MAX}
                step={5}
                value={settings.rate}
                onChange={(e) => void patchSettings({ rate: Number(e.target.value) })}
                className="w-40"
              />
              <span className="text-fg-3 text-xs">{settings.rate}</span>
              <button
                className="text-xs px-2 py-1 rounded-md border border-line"
                onClick={() => void api.voice.speak('This is how I sound at this speed.')}
              >
                试听
              </button>
            </span>
            <span className={k}>自动朗读 AI 回复</span>
            <Toggle
              on={settings.autoSpeak}
              onChange={(v) => void patchSettings({ autoSpeak: v })}
              label=""
            />
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">数据与隐私</h3>
          <p className="text-[12.5px] text-fg-2 leading-relaxed m-0">
            你输入的文字、确认后的课文文本会发送给
            Claude。课文图片只在你点击“识别”时发送一次，之后只使用文本。会话、课程只保存在本机数据库（应用数据目录下的
            my-tutor.db）。
          </p>
          <div className={kv}>
            <span className={k}>数据目录</span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-fg-3 text-xs font-mono break-all select-text">
                {dataDir ?? '读取中…'}
              </span>
              <button
                className="text-xs px-2 py-1 rounded-md border border-line shrink-0"
                onClick={() => void api.app.revealDataDir()}
              >
                在 Finder 中显示
              </button>
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
