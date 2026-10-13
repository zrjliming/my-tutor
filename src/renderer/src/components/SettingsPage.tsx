import { useEffect, useState } from 'react'
import type { AICheckResult, ModelProgressEvent, TTSVoice, VoiceStatus } from '@shared/types'
import { DEFAULT_SETTINGS, TTS_RATE_MAX, TTS_RATE_MIN, UI_LANGUAGES } from '@shared/types'
import type { UiLanguage } from '@shared/types'
import { api } from '../api'
import { LANGUAGE_NAMES, setLang, t } from '../i18n'
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
        {on ? t('settings.on') : t('settings.off')}
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
        if (e.type === 'cancelled') setVoiceError(t('settings.downloadCancelled'))
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
    try {
      await patchSettings({ whisperBinaryPath: v })
    } catch (e) {
      setVoiceError(t('settings.saveFailed', { message: String((e as Error)?.message ?? e) }))
      return
    }
    await refreshVoice()
  }
  const changeLanguage = async (uiLanguage: UiLanguage): Promise<void> => {
    await patchSettings({ uiLanguage })
    setLang(uiLanguage)
    // 音色名由主进程按界面语言生成，切换后重新取
    setVoices(await api.voice.listVoices().catch(() => []))
  }
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`
  const card = 'border border-line rounded-lg px-4 py-3.5 flex flex-col gap-2'
  const kv = 'grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 items-center'
  const k = 'text-fg-2 text-[12.5px]'
  const select = 'rounded-md border border-line bg-surface px-2 py-1'

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="px-4 pt-10 pb-3 border-b border-line">
        <h2 className="text-[15px] font-semibold">{t('settings.title')}</h2>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3.5 max-w-[720px]">
        <section className={card}>
          <div className={kv}>
            {/* 固定双语，界面切到看不懂的语言时也能找到这里 */}
            <label htmlFor="uiLanguage" className={k}>
              界面语言 / Language
            </label>
            <select
              id="uiLanguage"
              className={select}
              value={settings.uiLanguage}
              onChange={(e) => void changeLanguage(e.target.value as UiLanguage)}
            >
              {UI_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">{t('settings.claude.title')}</h3>
          <div className={kv}>
            <span className={k}>{t('settings.claude.model')}</span>
            <select
              id="model"
              className={select}
              value={settings.model}
              onChange={(e) => void patchSettings({ model: e.target.value })}
            >
              <option value="">{t('settings.claude.accountDefault')}</option>
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
                {t('settings.claude.check')}
              </button>
              {check === 'checking' && (
                <span className="text-fg-3 text-xs">{t('settings.claude.checking')}</span>
              )}
              {check && check !== 'checking' && (
                <span className={`text-xs ${check.ok ? 'text-good' : 'text-bad'}`}>
                  {check.ok
                    ? t('settings.claude.ok', {
                        model: check.model ?? '',
                        ms: check.durationMs ?? 0
                      })
                    : t('settings.claude.failed', { message: check.message ?? '' })}
                </span>
              )}
            </span>
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">{t('settings.learning.title')}</h3>
          <div className={kv}>
            <span className={k}>{t('settings.learning.difficulty')}</span>
            <select
              id="difficulty"
              className={select}
              value={settings.difficulty}
              onChange={(e) =>
                void patchSettings({ difficulty: e.target.value as typeof settings.difficulty })
              }
            >
              <option value="beginner">{t('settings.learning.beginner')}</option>
              <option value="intermediate">{t('settings.learning.intermediate')}</option>
              <option value="advanced">{t('settings.learning.advanced')}</option>
            </select>
            <span className={k}>{t('settings.learning.chineseExplanations')}</span>
            <Toggle
              on={settings.chineseExplanations}
              onChange={(v) => void patchSettings({ chineseExplanations: v })}
              label=""
            />
          </div>
          <p className="text-xs text-fg-3 m-0">{t('settings.learning.hint')}</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">{t('settings.asr.title')}</h3>
          <div className={kv}>
            <span className={k}>{t('settings.asr.binaryPath')}</span>
            <input
              id="whisperBinaryPath"
              key={settings.whisperBinaryPath}
              className={`${select} font-mono text-xs`}
              defaultValue={settings.whisperBinaryPath}
              placeholder={t('settings.asr.binaryPathPlaceholder', {
                path: DEFAULT_SETTINGS.whisperBinaryPath
              })}
              spellCheck={false}
              onBlur={(e) => void saveBinaryPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            <span className={k}>{t('settings.asr.binary')}</span>
            <span>
              {voice === null ? (
                <span className="text-fg-3">{t('settings.asr.checking')}</span>
              ) : voice.binaryFound ? (
                <>
                  <span className="text-good">{t('settings.asr.found')}</span>{' '}
                  <span className="text-fg-3">{voice.binaryPath}</span>
                </>
              ) : (
                <>
                  <span className="text-bad">{t('settings.asr.notFound')}</span>{' '}
                  <span className="text-fg-3">
                    {t('settings.asr.notFoundHint', { path: voice.binaryPath })}
                  </span>
                </>
              )}
            </span>
            <span className={k}>{t('settings.asr.model')}</span>
            <span className="flex items-center gap-2 flex-wrap">
              {voice === null ? (
                <span className="text-fg-3">{t('settings.asr.checking')}</span>
              ) : voice.modelFound ? (
                <>
                  <span className="text-good">{t('settings.asr.downloaded')}</span>
                  <span className="text-fg-3">ggml-small.en.bin · {mb(voice.modelBytes ?? 0)}</span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line text-bad"
                    onClick={() => void deleteModel()}
                  >
                    {confirmDeleteModel
                      ? t('settings.asr.confirmDelete')
                      : t('settings.asr.delete')}
                  </button>
                </>
              ) : progress ? (
                <>
                  <span className="text-fg-2">
                    {t('settings.asr.downloading', { size: mb(progress.received) })}
                    {progress.total ? ` / ${mb(progress.total)}` : ''}
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line"
                    onClick={() => void api.voice.cancelDownload()}
                  >
                    {t('settings.asr.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-bad">{t('settings.asr.notDownloaded')}</span>
                  <span className="text-fg-3">{t('settings.asr.modelSize')}</span>
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-line"
                    onClick={startDownload}
                  >
                    {t('settings.asr.download')}
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
          <p className="text-xs text-fg-3 m-0">{t('settings.asr.privacy')}</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">{t('settings.tts.title')}</h3>
          <div className={kv}>
            <span className={k}>{t('settings.tts.voice')}</span>
            <select
              id="voice"
              className={select}
              value={settings.voice}
              onChange={(e) => void patchSettings({ voice: e.target.value })}
            >
              {!voices.some((v) => v.id === settings.voice) && (
                <option value={settings.voice}>
                  {t('settings.tts.currentVoice', { voice: settings.voice })}
                </option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className={k}>{t('settings.tts.rate')}</span>
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
                {t('settings.tts.preview')}
              </button>
            </span>
            <span className={k}>{t('settings.tts.autoSpeak')}</span>
            <Toggle
              on={settings.autoSpeak}
              onChange={(v) => void patchSettings({ autoSpeak: v })}
              label=""
            />
          </div>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">{t('settings.data.title')}</h3>
          <p className="text-[12.5px] text-fg-2 leading-relaxed m-0">{t('settings.data.notice')}</p>
          <div className={kv}>
            <span className={k}>{t('settings.data.dir')}</span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-fg-3 text-xs font-mono break-all select-text">
                {dataDir ?? t('settings.data.loading')}
              </span>
              <button
                className="text-xs px-2 py-1 rounded-md border border-line shrink-0"
                onClick={() => void api.app.revealDataDir()}
              >
                {t('settings.data.reveal')}
              </button>
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
