import { describe, expect, test } from 'bun:test'
import { DomainError } from '@kit/core'
import { IdentityEvents } from '../contracts/events'
import { Email } from './email'
import { RefreshToken } from './refresh-token'
import { User } from './user'

const now = new Date('2026-01-01T00:00:00Z')

describe('Email', () => {
  test('normalizes case and whitespace', () => {
    expect(Email.create('  Foo@Example.COM ').value).toBe('foo@example.com')
  })
  test.each(['', 'plain', 'a@b', '@x.com', 'a b@c.com', `${'a'.repeat(250)}@x.com`])(
    'rejects %p',
    (raw) => {
      expect(() => Email.create(raw)).toThrow(DomainError)
    },
  )
})

describe('User', () => {
  test('register records a UserRegistered event carrying all data consumers need', () => {
    const user = User.register({ id: 'u1', email: Email.create('a@b.co'), locale: 'vi', now })
    expect(user.version).toBe(0)
    const [event] = user.pullEvents()
    expect(event?.type).toBe(IdentityEvents.UserRegistered)
    expect(event?.payload).toEqual({
      userId: 'u1',
      email: 'a@b.co',
      locale: 'vi',
      registeredAt: now.toISOString(),
    })
    expect(user.pullEvents()).toEqual([]) // once pulled, they are gone
  })

  test('changeEmail records old and new address; same address is rejected', () => {
    const user = User.restore({
      id: 'u1',
      version: 3,
      email: Email.create('old@b.co'),
      locale: 'en',
      createdAt: now,
      updatedAt: now,
    })
    expect(() => user.changeEmail(Email.create('OLD@b.co'), now)).toThrow('same')
    user.changeEmail(Email.create('new@b.co'), now)
    expect(user.email.value).toBe('new@b.co')
    expect(user.pullEvents()[0]?.payload).toMatchObject({
      oldEmail: 'old@b.co',
      newEmail: 'new@b.co',
    })
  })
})

describe('RefreshToken', () => {
  const token = (revokedAt: Date | null, replacedById: string | null) =>
    new RefreshToken(
      't',
      'u',
      'f',
      'h',
      new Date(now.getTime() + 1e9),
      now,
      revokedAt,
      replacedById,
      null,
      null,
    )

  test('a token rotated moments ago is a benign race, not theft', () => {
    const rotated = token(new Date(now.getTime() - 3_000), 'next')
    expect(rotated.isRecentlyRotated(now)).toBe(true)
  })
  test('reuse long after rotation, or of a token revoked without replacement, is suspicious', () => {
    expect(token(new Date(now.getTime() - 60_000), 'next').isRecentlyRotated(now)).toBe(false)
    expect(token(new Date(now.getTime() - 1_000), null).isRecentlyRotated(now)).toBe(false) // logout
    expect(token(null, null).isRecentlyRotated(now)).toBe(false)
  })
})
