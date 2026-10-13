import type { ImageInput } from '@shared/types'
import { t } from '../i18n'

const MAX_EDGE = 1600
const MAX_BYTES = 1.5 * 1024 * 1024

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('chat.image.decodeFailed')))
    img.src = src
  })
}

async function compress(img: HTMLImageElement, name?: string): Promise<ImageInput> {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('chat.image.canvasUnavailable'))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const q of [0.85, 0.75, 0.65, 0.5, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', q)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (base64.length * 0.75 <= MAX_BYTES) return { mime: 'image/jpeg', base64, name }
  }
  throw new Error(t('chat.image.tooLarge'))
}

export async function fileToImageInput(file: File): Promise<ImageInput> {
  const url = URL.createObjectURL(file)
  try {
    return await compress(await loadImage(url), file.name)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function rawToImageInput(raw: ImageInput): Promise<ImageInput> {
  return compress(await loadImage(`data:${raw.mime};base64,${raw.base64}`), raw.name)
}
