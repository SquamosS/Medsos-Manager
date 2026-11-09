import type { Media, MediaMetaInput } from '@shared/types'
import { call } from './api'

const MAX_THUMB = 480
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))])

function drawThumb(source: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, MAX_THUMB / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** Reads duration, size and a preview frame using the browser's own decoders. */
export async function probeMedia(media: Media): Promise<MediaMetaInput> {
  const src = `medsos://media/${media.id}`
  if (media.kind === 'image') {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await withTimeout(img.decode(), 15_000, 'Image decode')
    return { durationSec: null, width: img.naturalWidth, height: img.naturalHeight, thumbDataUrl: drawThumb(img, img.naturalWidth, img.naturalHeight) }
  }

  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  video.src = src
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('This video format cannot be read'))
      }),
      15_000,
      'Reading video'
    )
    const duration = Number.isFinite(video.duration) ? video.duration : null
    const w = video.videoWidth
    const h = video.videoHeight
    let thumb: string | null = null
    try {
      video.currentTime = duration ? Math.min(1, duration * 0.1) : 0
      await withTimeout(new Promise<void>((resolve) => (video.onseeked = () => resolve())), 10_000, 'Seeking')
      thumb = drawThumb(video, w, h)
    } catch {
      thumb = null // metadata is still useful without a preview frame
    }
    return { durationSec: duration, width: w || null, height: h || null, thumbDataUrl: thumb }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

export interface ImportResult {
  media: Media[]
  unreadable: string[]
}

/** Imports files into the library, then fills in metadata and thumbnails. */
export async function importPaths(paths: string[]): Promise<ImportResult> {
  const media = await call('media:import', paths)
  const unreadable: string[] = []
  const out: Media[] = []
  for (const m of media) {
    if (m.hasThumb || m.missing) {
      out.push(m)
      continue
    }
    try {
      const meta = await probeMedia(m)
      out.push((await call('media:setMeta', m.id, meta)) ?? m)
    } catch {
      unreadable.push(m.filename)
      out.push(m)
    }
  }
  return { media: out, unreadable }
}

export function isVertical(m: Media): boolean {
  return (m.height ?? 0) > (m.width ?? 0)
}
