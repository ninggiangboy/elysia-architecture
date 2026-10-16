import { describe, expect, test } from 'bun:test'
import { formatCardNumber, formatExpiry, isCardNumberValid, isCvcValid, parseExpiry } from './card'

describe('card', () => {
  test('numbers are grouped as they are typed', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('4242-42')).toBe('4242 42')
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
  })

  test('the checksum rejects a mistyped digit', () => {
    expect(isCardNumberValid('4242 4242 4242 4242')).toBe(true)
    expect(isCardNumberValid('4242 4242 4242 4241')).toBe(false)
    expect(isCardNumberValid('4242')).toBe(false)
  })

  test('expiry is formatted and read as MM / YY', () => {
    expect(formatExpiry('1229')).toBe('12 / 29')
    expect(formatExpiry('4')).toBe('04')
    const now = new Date(2026, 9, 16)
    expect(parseExpiry('12 / 29', now)).toEqual({ month: 12, year: 2029 })
    expect(parseExpiry('10 / 26', now)).toEqual({ month: 10, year: 2026 })
    expect(parseExpiry('09 / 26', now)).toBeNull()
    expect(parseExpiry('13 / 29', now)).toBeNull()
    expect(parseExpiry('12 /', now)).toBeNull()
  })

  test('American Express has a four-digit code', () => {
    expect(isCvcValid('123', '4242424242424242')).toBe(true)
    expect(isCvcValid('123', '378282246310005')).toBe(false)
    expect(isCvcValid('1234', '378282246310005')).toBe(true)
  })
})
