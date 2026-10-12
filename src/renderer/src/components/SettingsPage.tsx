import { useState } from 'react'
import type { AICheckResult } from '@shared/types'
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
          <h3 className="text-sm font-semibold">语音</h3>
          <p className="text-xs text-fg-3 m-0">语音识别与朗读在阶段 2 提供。</p>
        </section>
        <section className={card}>
          <h3 className="text-sm font-semibold">数据与隐私</h3>
          <p className="text-[12.5px] text-fg-2 leading-relaxed m-0">
            你输入的文字、确认后的课文文本会发送给
            Claude。课文图片只在你点击“识别”时发送一次，之后只使用文本。会话、课程只保存在本机数据库（应用数据目录下的
            speakmate.db）。
          </p>
        </section>
      </div>
    </div>
  )
}
