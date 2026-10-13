import type { UiLanguage } from '@shared/types'

// 主进程里会显示给用户的少量文案：按当前界面语言二选一。启动时和改设置时由调用方同步语言。
let current: UiLanguage = 'zh'

export function setMainLanguage(lang: UiLanguage): void {
  current = lang
}

export function tm(zh: string, en: string): string {
  return current === 'en' ? en : zh
}
