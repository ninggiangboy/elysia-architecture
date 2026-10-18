import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

/** RFC 4648 base32 without padding — the form authenticator apps expect for a secret. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/** 160-bit random secret (the size RFC 4226 recommends for HMAC-SHA1), base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** RFC 4226 HOTP: HMAC-SHA1 of the counter, dynamically truncated to `DIGITS` decimal digits. */
function hotp(secret: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', secret).update(message).digest()
  const offset = (mac[mac.length - 1] as number) & 0xf
  const binary = mac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The 30-second time step `at` falls in (RFC 6238 `T`). */
export const totpStep = (at: Date) => Math.floor(at.getTime() / 1000 / STEP_SECONDS)

/** The code an authenticator shows for `secret` at `at`. */
export function totpCode(secret: string, at: Date): string {
  return hotp(base32Decode(secret), totpStep(at))
}

/**
 * Checks a code against the current step and `window` steps either side (clock drift). Returns the step that matched,
 * so the caller can refuse it next time (a code must not work twice), or null.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  window = 1,
): { step: number } | null {
  const given = Buffer.from(code.replace(/\s/g, ''))
  if (given.length !== DIGITS) return null
  const key = base32Decode(secret)
  const now = totpStep(at)
  for (let step = now - window; step <= now + window; step++) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), given)) return { step }
  }
  return null
}

/** `otpauth://` URI an authenticator app reads from a QR code (Key Uri Format). */
export function totpUri(params: { secret: string; issuer: string; account: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`)
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${query}`
}
