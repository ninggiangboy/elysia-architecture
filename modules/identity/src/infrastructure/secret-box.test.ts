import { describe, expect, test } from 'bun:test'
import { SecretBox } from './secret-box'

describe('SecretBox', () => {
  const box = new SecretBox('a long passphrase for the tests')

  test('round-trips, and seals the same value differently each time', () => {
    const a = box.seal('JBSWY3DPEHPK3PXP')
    expect(box.open(a)).toBe('JBSWY3DPEHPK3PXP')
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(a)
    expect(a).not.toContain('JBSWY3DPEHPK3PXP')
  })

  test('another key, a tampered value or garbage cannot be opened', () => {
    const sealed = box.seal('secret')
    expect(() => new SecretBox('another passphrase').open(sealed)).toThrow()
    const [v, iv, tag, data] = sealed.split('.') as [string, string, string, string]
    const flipped = `${data.slice(0, -2)}${data.endsWith('AA') ? 'BB' : 'AA'}`
    expect(() => box.open([v, iv, tag, flipped].join('.'))).toThrow()
    expect(() => box.open('nonsense')).toThrow('Malformed')
  })
})
