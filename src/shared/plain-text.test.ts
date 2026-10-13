import { describe, expect, it } from 'vitest'
import { stripMarkdownEmphasis } from './plain-text'

describe('stripMarkdownEmphasis', () => {
  it('去掉加粗、斜体和行内代码标记', () => {
    expect(stripMarkdownEmphasis('You **went** there.')).toBe('You went there.')
    expect(stripMarkdownEmphasis('I __really__ like it')).toBe('I really like it')
    expect(stripMarkdownEmphasis('say *went*, not *goed*')).toBe('say went, not goed')
    expect(stripMarkdownEmphasis('use `have been` here')).toBe('use have been here')
    expect(stripMarkdownEmphasis('**I went** home')).toBe('I went home')
  })

  it('不动撇号、算式里的星号和下划线标识', () => {
    const keep = [
      "It's John's book, isn't it?",
      '2 * 3 = 6',
      '2*3*4 = 24',
      'a * b * c',
      'my_file_name',
      'rated 5* overall',
      '**',
      'unclosed **bold',
      '2**3 + 4**2'
    ]
    for (const s of keep) expect(stripMarkdownEmphasis(s)).toBe(s)
  })
})
