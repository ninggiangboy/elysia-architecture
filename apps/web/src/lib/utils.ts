import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Resolves once the image is loaded and decoded (or failed, or `timeoutMs` passed), so it shows up with the page, not after it. */
export function preloadImage(src: string, timeoutMs = 1000): Promise<void> {
  const img = new Image()
  img.src = src
  return Promise.race([
    img.decode().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}
