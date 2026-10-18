import { describe, expect, test } from 'bun:test'
import { DomainError } from '@kit/core'
import { MAX_REPLY_LENGTH, Reply } from './reply'

describe('Reply', () => {
  test('keeps a trimmed text', () => {
    expect(Reply.of('  pong ').text).toBe('pong')
  })

  test('refuses an empty or an oversized text', () => {
    expect(() => Reply.of('   ')).toThrow(DomainError)
    expect(() => Reply.of('x'.repeat(MAX_REPLY_LENGTH + 1))).toThrow(DomainError)
  })
})
