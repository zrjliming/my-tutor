import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'
import { tm } from '../i18n'

export type Db = DatabaseSync

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  try {
    migrate(db)
  } catch (e) {
    db.close()
    throw e
  }
  return db
}

export function migrate(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  if (version > MIGRATIONS.length) {
    throw new Error(
      tm(
        `数据库版本 (${version}) 比应用新，请升级应用`,
        `Database version (${version}) is newer than the app. Please update the app.`
      )
    )
  }
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return version
}
