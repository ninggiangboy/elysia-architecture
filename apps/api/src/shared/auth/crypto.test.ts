import { describe, expect, test } from 'bun:test'
import { hmacSha256Hex, sha256Hex } from './crypto'

describe('hmacSha256Hex', () => {
  test('is deterministic for the same secret and input', () => {
    expect(hmacSha256Hex('s', 'u:123456')).toBe(hmacSha256Hex('s', 'u:123456'))
  })

  test('depends on the secret: a leaked table alone cannot be brute-forced', () => {
    expect(hmacSha256Hex('a', 'u:123456')).not.toBe(hmacSha256Hex('b', 'u:123456'))
    expect(hmacSha256Hex('a', 'u:123456')).not.toBe(sha256Hex('u:123456'))
  })

  test('depends on the input', () => {
    expect(hmacSha256Hex('s', 'u:123456')).not.toBe(hmacSha256Hex('s', 'u:123457'))
  })
})
