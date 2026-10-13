import { useSyncExternalStore } from 'react'
import type { UiLanguage } from '@shared/types'
import zhChat from './locales/zh/chat'
import zhPages from './locales/zh/pages'
import zhSettings from './locales/zh/settings'
import enChat from './locales/en/chat'
import enPages from './locales/en/pages'
import enSettings from './locales/en/settings'

// 新增语言：在 locales 下复制一份目录翻译，在这里登记，并把代码加进 shared/types 的 UI_LANGUAGES
const DICTS: Record<UiLanguage, Record<string, string>> = {
  zh: { ...zhChat, ...zhPages, ...zhSettings },
  en: { ...enChat, ...enPages, ...enSettings }
}

/** 设置页语言下拉显示的名称（用各自语言写） */
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { zh: '中文', en: 'English' }

let current: UiLanguage = 'zh'
const listeners = new Set<() => void>()

export function getLang(): UiLanguage {
  return current
}

export function setLang(lang: UiLanguage): void {
  if (lang === current) return
  current = lang
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  listeners.forEach((f) => f())
}

/** 订阅当前语言；App 根组件用它在切换时整体重渲染 */
export function useLang(): UiLanguage {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => current
  )
}

/** 取文案：当前语言缺键时回退中文，再缺则返回键名本身；{name} 用 vars 替换 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[current][key] ?? DICTS.zh[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}
