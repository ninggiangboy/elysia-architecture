import { describe, expect, test } from 'bun:test'
import {
  base32Decode,
  base32Encode,
  newTotpSecret,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp'

// RFC 6238 appendix B: the SHA1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'))

describe('base32', () => {
  test('round-trips and matches RFC 4648', () => {
    expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
    expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI'))).toBe('foobar')
    expect(base32Decode('mzxw 6ytb oi====')).toEqual(base32Decode('MZXW6YTBOI'))
  })

  test('refuses characters outside the alphabet', () => {
    expect(() => base32Decode('MZ1W')).toThrow()
  })
})

describe('totp', () => {
  test('matches the RFC 6238 test vectors (last 6 digits)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ]
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, new Date(seconds * 1000))).toBe(code)
    }
  })

  test('accepts one step of drift either side and reports the step that matched', () => {
    const now = new Date(1_700_000_000_000)
    const previous = totpCode(RFC_SECRET, new Date(now.getTime() - 30_000))
    expect(verifyTotp(RFC_SECRET, previous, now)).toEqual({ step: totpStep(now) - 1 })
    const twoBack = totpCode(RFC_SECRET, new Date(now.getTime() - 60_000))
    expect(verifyTotp(RFC_SECRET, twoBack, now)).toBeNull()
  })

  test('ignores spaces and refuses codes of the wrong length', () => {
    const now = new Date(1_700_000_000_000)
    const code = totpCode(RFC_SECRET, now)
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull()
    expect(verifyTotp(RFC_SECRET, code.slice(1), now)).toBeNull()
  })

  test('a new secret is 160 bits of base32', () => {
    const secret = newTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(newTotpSecret()).not.toBe(secret)
  })

  test('the otpauth URI names the issuer and the account', () => {
    const uri = totpUri({ secret: 'ABC', issuer: 'Acme', account: 'a@b.test' })
    const [path, query] = uri.split('?') as [string, string]
    expect(decodeURIComponent(path)).toBe('otpauth://totp/Acme:a@b.test')
    const params = new URLSearchParams(query)
    expect(params.get('secret')).toBe('ABC')
    expect(params.get('issuer')).toBe('Acme')
  })
})
