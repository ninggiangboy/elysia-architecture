import { Minus, Plus } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { i18n } from '@/i18n'
import { errorMessage } from '@/lib/api'
import {
  type Crop,
  clampCrop,
  initialCrop,
  MAX_ZOOM,
  MIN_ZOOM,
  renderCrop,
  visibleSize,
} from '@/lib/crop'
import { cn } from '@/lib/utils'

interface Loaded {
  url: string
  element: HTMLImageElement
}

/** Pick the part of a photo that becomes the avatar/cover: drag to move, slider or wheel to zoom, framed exactly as it will show. */
export function ImageCropDialog({
  file,
  title,
  aspect,
  round,
  outputWidth,
  saving,
  onSave,
  onClose,
  className,
}: {
  file: File
  title: string
  /** width ÷ height of the frame (and of the saved image) */
  aspect: number
  /** Dim everything outside a circle (the avatar is shown round). */
  round?: boolean
  /** Pixel width of the saved image. */
  outputWidth: number
  saving: boolean
  onSave: (image: Blob) => void
  onClose: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [image, setImage] = useState<Loaded | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [frameWidth, setFrameWidth] = useState(0)
  const [rendering, setRendering] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerX: number; pointerY: number; start: Crop } | null>(null)
  // Callers pass a fresh closure every render; the image must only be (re)loaded when the file changes.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => {
      setImage({ url, element })
      setCrop(initialCrop({ width: element.naturalWidth, height: element.naturalHeight }))
    }
    element.onerror = () => {
      toast.error(i18n.t('crop.unreadable'))
      closeRef.current()
    }
    element.src = url
    return () => {
      // Revoking the URL fails a load still in flight (StrictMode runs this effect twice) — that is not a bad image.
      element.onload = element.onerror = null
      URL.revokeObjectURL(url)
    }
  }, [file])

  const size = image && {
    width: image.element.naturalWidth,
    height: image.element.naturalHeight,
  }
  const update = (next: Crop) => size && setCrop(clampCrop(size, aspect, next))

  // The frame is fluid, so the image scale (screen px per image px) follows its measured width.
  useEffect(() => {
    const el = frame.current
    if (!el || !image) return
    const observer = new ResizeObserver(() => setFrameWidth(el.clientWidth))
    observer.observe(el)
    setFrameWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [image])

  // React registers `wheel` as passive, which cannot stop the page from scrolling.
  const wheelZoom = useRef((_: number) => {})
  wheelZoom.current = (deltaY) => update({ ...crop, zoom: crop.zoom * Math.exp(-deltaY * 0.002) })
  useEffect(() => {
    const el = frame.current
    if (!el || !image) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      wheelZoom.current(e.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [image])

  const view = size && visibleSize(size, aspect, crop.zoom)
  const scale = view && frameWidth ? frameWidth / view.width : 0 // screen px per image px
  const frameHeight = frameWidth / aspect

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointerX: e.clientX, pointerY: e.clientY, start: crop }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || !scale) return
    update({
      ...d.start,
      x: d.start.x - (e.clientX - d.pointerX) / scale,
      y: d.start.y - (e.clientY - d.pointerY) / scale,
    })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!view) return
    const step = view.width * 0.05
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (move) update({ ...crop, x: crop.x + move[0], y: crop.y + move[1] })
    else if (e.key === '+' || e.key === '=') update({ ...crop, zoom: crop.zoom * 1.1 })
    else if (e.key === '-') update({ ...crop, zoom: crop.zoom / 1.1 })
    else return
    e.preventDefault()
  }

  const save = async () => {
    if (!image) return
    setRendering(true)
    try {
      onSave(await renderCrop(image.element, aspect, crop, outputWidth))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRendering(false)
    }
  }

  const busy = saving || rendering
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={busy}
      className={cn(aspect > 1.5 ? 'max-w-2xl' : 'max-w-md', className)}
    >
      <div
        ref={frame}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a custom pan/zoom surface operated with the keyboard
        tabIndex={0}
        aria-label={t('crop.area')}
        style={{ aspectRatio: aspect }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        data-testid="crop-frame"
        className="relative w-full cursor-grab touch-none overflow-hidden rounded-lg bg-muted outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 active:cursor-grabbing"
      >
        {image && size && scale > 0 && (
          <img
            src={image.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
            style={{
              width: size.width * scale,
              height: size.height * scale,
              transform: `translate(${frameWidth / 2 - crop.x * scale}px, ${frameHeight / 2 - crop.y * scale}px)`,
            }}
          />
        )}
        {round && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-white/80"
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="range"
          aria-label={t('crop.zoom')}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          disabled={!image}
          onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })}
          className="h-5 w-full accent-primary"
        />
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('crop.help')}</p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={save} loading={busy} disabled={!image}>
          {t('crop.save')}
        </Button>
      </div>
    </Dialog>
  )
}
