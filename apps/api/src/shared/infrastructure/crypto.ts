import { createHash, randomBytes } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 256-bit random token, base64url — used for magic link / refresh token / email change. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
