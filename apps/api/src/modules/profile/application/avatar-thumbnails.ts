/** Edge lengths (px) of the square thumbnails generated for every avatar. */
export const AVATAR_THUMBNAIL_SIZES = [64, 256] as const

export const AVATAR_THUMBNAIL_CONTENT_TYPE = 'image/webp'

/** `u1/abc.png` → `u1/abc.256.webp`. Derived from the avatar key, so reruns overwrite and cleanup needs no lookup. */
export function avatarThumbnailKey(avatarKey: string, size: number): string {
  const dot = avatarKey.lastIndexOf('.')
  const base = dot > avatarKey.lastIndexOf('/') ? avatarKey.slice(0, dot) : avatarKey
  return `${base}.${size}.webp`
}

export const avatarThumbnailKeys = (avatarKey: string) =>
  AVATAR_THUMBNAIL_SIZES.map((size) => avatarThumbnailKey(avatarKey, size))
