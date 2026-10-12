const SECRET_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']
const FALLBACK_PATH = ['/usr/bin', '/bin']

export function cleanEnv(src: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || SECRET_VARS.includes(k)) continue
    out[k] = v
  }
  const existing = (src.PATH ?? FALLBACK_PATH.join(':')).split(':').filter(Boolean)
  const merged = [...EXTRA_PATH, ...existing].filter((p, i, arr) => arr.indexOf(p) === i)
  out.PATH = merged.join(':')
  return out
}
