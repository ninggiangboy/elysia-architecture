import { describe, expect, test } from 'bun:test'
import { diffCatalogs } from '@app/shared-types'
import { en } from './locales/en'
import { vi } from './locales/vi'

describe('web catalogs', () => {
  test('every translation has the same keys and placeholders as the English source', () => {
    expect(diffCatalogs(en, vi)).toEqual([])
  })
})
