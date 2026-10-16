import { createHash, randomBytes, randomInt } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 256-bit random token, base64url — used for magic link / refresh token / email change. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Uniformly random decimal code, zero-padded (`000042`). */
export function randomDigits(digits: number): string {
  return String(randomInt(10 ** digits)).padStart(digits, '0')
}
