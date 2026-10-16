import { describe, expect, test } from 'bun:test'
import { currencyDigits, formatMoneyIn, parseMoney } from './money'

describe('money', () => {
  test('currencies know how many digits their smallest unit is', () => {
    expect(currencyDigits('usd')).toBe(2)
    expect(currencyDigits('eur')).toBe(2)
    expect(currencyDigits('vnd')).toBe(0)
  })

  test('an amount in the smallest unit is shown in whole units', () => {
    expect(formatMoneyIn('en', 2050, 'usd')).toBe('$20.50')
    expect(formatMoneyIn('en', 1000, 'eur')).toContain('10.00')
    expect(formatMoneyIn('en', 200_000, 'vnd')).toContain('200,000')
    expect(formatMoneyIn('vi', 200_000, 'vnd')).toContain('200.000')
  })

  test('what a person types becomes the smallest unit', () => {
    expect(parseMoney('20', 'usd')).toBe(2000)
    expect(parseMoney(' 20.5 ', 'usd')).toBe(2050)
    expect(parseMoney('20,5', 'usd')).toBe(2050)
    expect(parseMoney('75000', 'vnd')).toBe(75_000)
    expect(parseMoney('0.1', 'usd')).toBe(10)
  })

  test('anything that is not a plain number is refused', () => {
    for (const input of ['', 'abc', '-5', '1e3', '1.2.3', '$5'])
      expect(parseMoney(input, 'usd')).toBeNull()
  })
})
