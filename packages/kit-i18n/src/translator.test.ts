import { describe, expect, test } from 'bun:test'
import { createTranslator } from './translator'

const en = {
  hello: 'Hello {{name}}',
  items_one: '{{count}} item',
  items_other: '{{count}} items',
  onlyEnglish: 'Only English',
} as const
const vi = { hello: 'Xin chào {{name}}', items_other: '{{count}} mục' } as const

describe('createTranslator', () => {
  const translate = createTranslator('en', en, { vi })

  test('fills placeholders', () => {
    expect(translate('en')('hello', { name: 'Ann' })).toBe('Hello Ann')
    expect(translate('vi')('hello', { name: 'Ann' })).toBe('Xin chào Ann')
  })

  test('picks the plural form of the language', () => {
    expect(translate('en')('items', { count: 1 })).toBe('1 item')
    expect(translate('en')('items', { count: 3 })).toBe('3 items')
    expect(translate('vi')('items', { count: 1 })).toBe('1 mục')
  })

  test('falls back to the default language, then to the key', () => {
    expect(translate('vi')('onlyEnglish')).toBe('Only English')
    expect(translate('fr')('hello', { name: 'Ann' })).toBe('Hello Ann')
    expect((translate('en') as (key: string) => string)('missing')).toBe('missing')
  })
})
