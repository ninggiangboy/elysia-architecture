import { describe, expect, test } from 'bun:test'
import { StepUpPolicy } from '#/shared/auth'
import { ForbiddenError } from '#/shared/core'
import { FakeClock } from '#/shared/testing'
import { Passkey } from '../domain/passkey'

const NOW = new Date('2026-01-01T00:00:00Z')
const seconds = (d: Date) => d.getTime() / 1000

describe('StepUpPolicy', () => {
  const policy = new StepUpPolicy(new FakeClock(NOW), 300)

  test('accepts a confirmation inside the window, boundary included', () => {
    expect(() => policy.assertFresh(seconds(NOW))).not.toThrow()
    expect(() => policy.assertFresh(seconds(NOW) - 300)).not.toThrow()
  })

  test('asks again once the window passed or when there never was one', () => {
    for (const authTime of [seconds(NOW) - 301, undefined]) {
      try {
        policy.assertFresh(authTime)
        throw new Error('expected a step-up error')
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError)
        expect((err as ForbiddenError).code).toBe('step_up_required')
      }
    }
  })
})

describe('Passkey', () => {
  const make = (counter: number) =>
    Passkey.restore({
      id: 'p1',
      version: 1,
      userId: 'u1',
      credentialId: 'cred',
      publicKey: new Uint8Array([1]),
      counter,
      transports: [],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Key',
      createdAt: NOW,
      lastUsedAt: null,
    })

  test('a counter must move forward for authenticators that count', () => {
    const key = make(5)
    key.recordUse(6, false, NOW)
    expect(key.counter).toBe(6)
    expect(key.lastUsedAt).toEqual(NOW)
    expect(() => key.recordUse(6, false, NOW)).toThrow('cannot be trusted')
    expect(() => key.recordUse(2, false, NOW)).toThrow('cannot be trusted')
  })

  test('synced passkeys report 0 every time and are not mistaken for clones', () => {
    const key = make(0)
    key.recordUse(0, true, NOW)
    key.recordUse(0, true, NOW)
    expect(key.backedUp).toBe(true)
  })

  test('names are trimmed, capped and never empty; registering records the event', () => {
    expect(Passkey.normalizeName('   ')).toBe('Passkey')
    expect(Passkey.normalizeName(`  ${'x'.repeat(100)} `)).toHaveLength(60)
    const added = Passkey.register({
      id: 'p2',
      userId: 'u1',
      credentialId: 'c2',
      publicKey: new Uint8Array([1]),
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
      name: ' Phone ',
      now: NOW,
    })
    expect(added.name).toBe('Phone')
    expect(added.pullEvents().map((e) => e.type)).toEqual(['identity.passkey_added.v1'])
  })
})
