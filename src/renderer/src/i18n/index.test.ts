import { describe, expect, it } from 'vitest'
import { UI_LANGUAGES } from '@shared/types'
import zhChat from './locales/zh/chat'
import zhPages from './locales/zh/pages'
import zhSettings from './locales/zh/settings'
import enChat from './locales/en/chat'
import enPages from './locales/en/pages'
import enSettings from './locales/en/settings'

describe('i18n 词典', () => {
  it('英文与中文键集合一致', () => {
    const pairs = [
      [zhChat, enChat],
      [zhPages, enPages],
      [zhSettings, enSettings]
    ]
    for (const [zh, en] of pairs) expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
  it('登记的语言', () => {
    expect([...UI_LANGUAGES]).toEqual(['zh', 'en'])
  })
})
