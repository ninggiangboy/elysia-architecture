/** Hằng số dùng chung web ↔ api (không chứa logic). */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export const AVATAR_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AvatarContentType = keyof typeof AVATAR_CONTENT_TYPES

export const DISPLAY_NAME_MAX = 50
export const BIO_MAX = 280

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown }
}
