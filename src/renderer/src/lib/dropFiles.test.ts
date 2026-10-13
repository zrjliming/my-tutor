import { describe, it, expect } from 'vitest'
import { classifyFiles, readTextFiles } from './dropFiles'

const file = (name: string, type: string, body = ''): File => new File([body], name, { type })

describe('classifyFiles', () => {
  it('按类型和扩展名分类', () => {
    const r = classifyFiles([
      file('a.png', 'image/png'),
      file('b.txt', 'text/plain'),
      file('c.md', ''),
      file('d.MARKDOWN', ''),
      file('e.csv', 'text/csv'),
      file('f.pdf', 'application/pdf'),
      file('g', '')
    ])
    expect(r.images.map((f) => f.name)).toEqual(['a.png'])
    expect(r.texts.map((f) => f.name)).toEqual(['b.txt', 'c.md', 'd.MARKDOWN', 'e.csv'])
    expect(r.other.map((f) => f.name)).toEqual(['f.pdf', 'g'])
  })
})

describe('readTextFiles', () => {
  it('合并多个文本并跳过空文件', async () => {
    const text = await readTextFiles([
      file('a.txt', 'text/plain', ' Hello \n'),
      file('b.txt', 'text/plain', '  '),
      file('c.md', '', 'World')
    ])
    expect(text).toBe('Hello\n\nWorld')
  })
})
