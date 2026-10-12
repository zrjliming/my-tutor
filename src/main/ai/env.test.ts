import { describe, it, expect } from 'vitest'
import { cleanEnv } from './env'

describe('cleanEnv', () => {
  it('removes API key variables that would override the subscription login', () => {
    const out = cleanEnv({
      HOME: '/Users/x',
      ANTHROPIC_API_KEY: 'sk',
      ANTHROPIC_AUTH_TOKEN: 't',
      CLAUDE_CODE_OAUTH_TOKEN: 'o',
      PATH: '/usr/bin'
    })
    expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(out.HOME).toBe('/Users/x')
  })
  it('adds homebrew and local bin to a minimal Finder PATH', () => {
    const out = cleanEnv({ PATH: '/usr/bin:/bin' })
    expect(out.PATH.split(':')).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])
  })
  it('does not duplicate PATH entries and tolerates missing PATH', () => {
    expect(cleanEnv({ PATH: '/opt/homebrew/bin:/usr/bin' }).PATH).toBe(
      '/opt/homebrew/bin:/usr/local/bin:/usr/bin'
    )
    expect(cleanEnv({}).PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
  })
  it('drops undefined values', () => {
    expect('X' in cleanEnv({ X: undefined })).toBe(false)
  })
})
