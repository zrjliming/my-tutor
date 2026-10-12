import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import type { Db } from './index'

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as {
    key: string
    value: string
  }[]
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value)
  }
  return out as unknown as AppSettings
}

export function patchSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const up = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !(k in DEFAULT_SETTINGS)) continue
    up.run(k, JSON.stringify(v))
  }
  return getSettings(db)
}
