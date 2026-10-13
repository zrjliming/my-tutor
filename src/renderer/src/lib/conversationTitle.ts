import { MODE_LABEL, type Conversation } from '@shared/types'
import { t } from '../i18n'

/** 默认标题建会话时按中文模式名存库；显示时换成当前界面语言（自定义 / 课程标题不动） */
export function conversationTitle(c: Conversation): string {
  const zh = MODE_LABEL[c.mode]
  const label = t(`chat.mode.${c.mode}`)
  if (c.title === zh) return label
  if (c.title.endsWith(` · ${zh}`)) return `${c.title.slice(0, -zh.length)}${label}`
  return c.title
}
