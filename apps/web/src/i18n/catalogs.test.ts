import { describe, expect, test } from 'bun:test'
import { diffCatalogs } from '@kit/i18n'
import { catalog } from './catalog'

describe('web catalogs (the shell plus every feature)', () => {
  test('every translation has the same keys and placeholders as the English source', () => {
    expect(diffCatalogs(catalog('en'), catalog('vi'))).toEqual([])
  })
})
