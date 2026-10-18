import { describe, expect, test } from 'bun:test'
import { defineLocales } from './locales'

const { LOCALES, DEFAULT_LOCALE, isLocale, matchLocale, negotiateLocale } = defineLocales(
  ['en', 'vi'],
  { default: 'en', names: { en: 'English', vi: 'Tiếng Việt' } },
)

describe('defineLocales', () => {
  test('keeps the list and the default', () => {
    expect(LOCALES).toEqual(['en', 'vi'])
    expect(DEFAULT_LOCALE).toBe('en')
  })

  test('isLocale only accepts a language of the list', () => {
    expect(isLocale('vi')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  test('matchLocale reads the primary subtag', () => {
    expect(matchLocale('vi-VN')).toBe('vi')
    expect(matchLocale(' EN_gb ')).toBe('en')
    expect(matchLocale('fr-FR')).toBeNull()
  })

  test('negotiateLocale picks the highest weight we speak', () => {
    expect(negotiateLocale('fr-FR,vi;q=0.8,en;q=0.5')).toBe('vi')
    expect(negotiateLocale('en;q=0.2, vi;q=0.9')).toBe('vi')
    expect(negotiateLocale('fr, de')).toBeNull()
    expect(negotiateLocale('vi;q=0')).toBeNull()
    expect(negotiateLocale(null)).toBeNull()
  })
})
