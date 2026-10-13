// 把拖进来的文件分成图片 / 文本 / 其他三类；macOS 上 .md 的 type 常为空，所以也看扩展名
export interface DroppedFiles {
  images: File[]
  texts: File[]
  other: File[]
}

const TEXT_EXT = /\.(txt|md|markdown)$/i

export function classifyFiles(files: Iterable<File> | ArrayLike<File>): DroppedFiles {
  const out: DroppedFiles = { images: [], texts: [], other: [] }
  for (const f of Array.from(files)) {
    if (f.type.startsWith('image/')) out.images.push(f)
    else if (f.type.startsWith('text/') || TEXT_EXT.test(f.name)) out.texts.push(f)
    else out.other.push(f)
  }
  return out
}

export async function readTextFiles(files: File[]): Promise<string> {
  const parts = await Promise.all(files.map((f) => f.text()))
  return parts
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n')
}
