import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface AppPaths {
  userData: string
  db: string
  lessonsDir: string
  sessionsDir: string
  tmpDir: string
  modelsDir: string
}

export function resolvePaths(userData: string): AppPaths {
  const paths: AppPaths = {
    userData,
    db: join(userData, 'my-tutor.db'),
    lessonsDir: join(userData, 'lessons'),
    sessionsDir: join(userData, 'claude-sessions'),
    tmpDir: join(userData, 'tmp'),
    modelsDir: join(userData, 'models')
  }
  for (const dir of [paths.lessonsDir, paths.sessionsDir, paths.tmpDir, paths.modelsDir])
    mkdirSync(dir, { recursive: true })
  return paths
}
