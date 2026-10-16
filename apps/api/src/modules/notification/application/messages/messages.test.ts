import { describe, expect, test } from 'bun:test'
import { diffCatalogs, LOCALES } from '@app/shared-types'
import { en } from './en'
import { translate } from './index'
import { vi } from './vi'

describe('notification messages', () => {
  test('every translation has the same keys and placeholders as the English source', () => {
    expect(diffCatalogs(en, vi)).toEqual([])
  })

  test('every supported language has a catalog', () => {
    for (const locale of LOCALES)
      expect(translate(locale)('mail.welcome.subject')).not.toBe('mail.welcome.subject')
  })

  test('fills placeholders and picks the plural form', () => {
    const t = translate('en')
    expect(t('common.minutes', { count: 1 })).toBe('1 minute')
    expect(t('common.minutes', { count: 5 })).toBe('5 minutes')
    expect(translate('vi')('common.minutes', { count: 1 })).toBe('1 phút')
    expect(t('mail.welcome.body', { email: 'a@b.co' })).toBe('Your account a@b.co is ready.')
  })

  test('catches a translation that drops a placeholder or misses a key', () => {
    expect(diffCatalogs({ a: 'Hi {{name}}', b: 'x' }, { a: 'Chào' })).toEqual([
      'placeholders differ: a',
      'missing: b',
    ])
    expect(diffCatalogs({ a: 'x' }, { a: 'x', extra: 'y' })).toEqual(['unknown: extra'])
  })
})
