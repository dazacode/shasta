// The person's own new tab picture. It is shrunk in the browser and kept in IndexedDB (`media`) on this device only:
// it is never uploaded, never part of a profile export, and settings hold just a stamp that says one exists.
import { useEffect, useState } from 'react'
import { get, put, remove } from '@/lib/db'

const ID = 'newtab-bg'
export const MAX_PICTURE_BYTES = 25 * 1024 * 1024
const MAX_SIDE = 2560
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']
export const PICTURE_ACCEPT = TYPES.join(',')

interface Stored {
  id: string
  blob: Blob
  /** average brightness 0-1, to pick light or dark text */
  luma: number
}

export type SavedPicture = { stamp: string; luma: number }

/** Shrinks the picture to at most 2560 px on the long side and measures its brightness. Rejects what is not a picture. */
export async function savePicture(file: File): Promise<SavedPicture> {
  if (!TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, AVIF or GIF picture.')
  if (file.size > MAX_PICTURE_BYTES) throw new Error('That picture is larger than 25 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This browser could not read that picture.')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser could not read that picture.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const luma = measureLuma(ctx, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
  if (!blob) throw new Error('This browser could not save that picture.')
  await put<Stored>('media', { id: ID, blob, luma })
  return { stamp: String(Date.now()), luma }
}

function measureLuma(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 48))
  const { data } = ctx.getImageData(0, 0, w, h)
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      n++
    }
  }
  return n ? sum / n : 0.5
}

export async function removePicture(): Promise<void> {
  await remove('media', ID)
}

/** A "#rrggbb" colour's brightness, 0-1. */
export function hexLuma(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** The saved picture as an object URL (revoked on change/unmount), or null while loading, missing or unreadable. */
export function usePicture(stamp: string | null): { url: string; luma: number } | null {
  const [pic, setPic] = useState<{ url: string; luma: number } | null>(null)
  useEffect(() => {
    if (!stamp) {
      setPic(null)
      return
    }
    let stale = false
    let url: string | null = null
    void (async () => {
      try {
        const rec = await get<Stored>('media', ID)
        if (!rec || stale) return
        url = URL.createObjectURL(rec.blob)
        setPic({ url, luma: rec.luma })
      } catch {
        if (!stale) setPic(null)
      }
    })()
    return () => {
      stale = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [stamp])
  return pic
}
