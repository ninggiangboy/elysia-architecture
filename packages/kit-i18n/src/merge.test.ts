import { describe, expect, test } from 'bun:test'
import { mergeCatalogs, messagePaths, overrideCatalog } from './merge'

describe('mergeCatalogs', () => {
  test('merges branches that different owners fill', () => {
    expect(mergeCatalogs({ mail: { a: 'A' }, common: { x: 'X' } }, { mail: { b: 'B' } })).toEqual({
      mail: { a: 'A', b: 'B' },
      common: { x: 'X' },
    })
  })

  test('a key defined twice is an error that names it', () => {
    expect(() => mergeCatalogs({ mail: { a: 'A' } }, { mail: { a: 'again' } })).toThrow(
      'Duplicate message key: mail.a',
    )
    expect(() => mergeCatalogs({ a: 'text' }, { a: { b: 'group' } })).toThrow(
      'Duplicate message key: a',
    )
  })
})

describe('overrideCatalog', () => {
  test('replaces an existing message and leaves the rest', () => {
    expect(overrideCatalog({ mail: { a: 'A', b: 'B' } }, { mail: { a: 'new' } })).toEqual({
      mail: { a: 'new', b: 'B' },
    })
  })

  test('rejects a key the base does not have', () => {
    expect(() => overrideCatalog({ mail: { a: 'A' } }, { mail: { typo: 'x' } })).toThrow(
      'Cannot override unknown message key: mail.typo',
    )
  })
})

test('messagePaths folds plural forms', () => {
  expect([...messagePaths({ a: { n_one: '1', n_other: 'many' }, b: 'x' })].sort()).toEqual([
    'a.n',
    'b',
  ])
})
