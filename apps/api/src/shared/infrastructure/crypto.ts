import { createHash, randomBytes } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Token ngẫu nhiên 256 bit, base64url — dùng cho magic link / refresh token / email change. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
