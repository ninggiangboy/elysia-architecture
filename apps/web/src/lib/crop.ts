import { COVER_CONTENT_TYPES } from '@app/shared-types'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
/** The picked file only has to be decodable — the cropped result is what gets uploaded (and size-checked by the API). */
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024

/** `x`/`y`: the point of the image (in image pixels) shown at the centre of the frame. */
export interface Crop {
  zoom: number
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export const initialCrop = (image: Size): Crop => ({
  zoom: 1,
  x: image.width / 2,
  y: image.height / 2,
})

/** The part of the image (in image pixels) the frame shows. At zoom 1 the image just covers the frame. */
export function visibleSize(image: Size, aspect: number, zoom: number): Size {
  const fitsHeight = image.width / image.height > aspect
  const height = (fitsHeight ? image.height : image.width / aspect) / zoom
  return { width: height * aspect, height }
}

/** Keeps the frame inside the image, so there is never an empty strip in the result. */
export function clampCrop(image: Size, aspect: number, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM)
  const view = visibleSize(image, aspect, zoom)
  return {
    zoom,
    x: clamp(crop.x, view.width / 2, image.width - view.width / 2),
    y: clamp(crop.y, view.height / 2, image.height - view.height / 2),
  }
}

/** Error message for a file that cannot be used as a source image, or null. */
export function sourceError(file: File): string | null {
  if (!(file.type in COVER_CONTENT_TYPES)) return 'Image must be JPEG, PNG or WebP'
  if (file.size > SOURCE_MAX_BYTES)
    return `Image must be at most ${SOURCE_MAX_BYTES / 1024 / 1024} MB`
  return null
}

/** Draws the cropped region into a `width`-wide canvas (height follows the aspect) and encodes it (WebP when supported). */
export function renderCrop(
  image: HTMLImageElement,
  aspect: number,
  crop: Crop,
  width: number,
): Promise<Blob> {
  const { zoom, x, y } = clampCrop(
    { width: image.naturalWidth, height: image.naturalHeight },
    aspect,
    crop,
  )
  const view = visibleSize({ width: image.naturalWidth, height: image.naturalHeight }, aspect, zoom)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.round(width / aspect)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not process this image'))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    x - view.width / 2,
    y - view.height / 2,
    view.width,
    view.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process this image'))),
      'image/webp',
      0.9,
    ),
  )
}
