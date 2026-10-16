import { describe, expect, test } from 'bun:test'
import { DomainError } from '#/shared/domain/errors'
import { ProfileEvents } from '../contracts/events'
import { Profile } from './profile'
import { Bio, DisplayName } from './value-objects'

const now = new Date('2026-01-01T00:00:00Z')

describe('value objects', () => {
  test('DisplayName trims and enforces 1..50 chars without control characters', () => {
    expect(DisplayName.create('  An  ').value).toBe('An')
    for (const bad of ['', '   ', 'x'.repeat(51), 'a\nb'])
      expect(() => DisplayName.create(bad)).toThrow(DomainError)
  })
  test('default display name derives from the email local part', () => {
    expect(DisplayName.fromEmail('jane.doe@example.com').value).toBe('jane.doe')
    expect(DisplayName.fromEmail(`${'x'.repeat(80)}@a.co`).value).toHaveLength(50)
  })
  test('Bio: empty clears, over 280 is rejected', () => {
    expect(Bio.create('   ')).toBeNull()
    expect(() => Bio.create('x'.repeat(281))).toThrow(DomainError)
  })
})

describe('Profile', () => {
  const fresh = () => Profile.createDefault({ userId: 'u1', email: 'jane@example.com', now })

  test('update only touches provided fields; bio null clears it', () => {
    const p = fresh()
    p.update({ displayName: 'Jane', bio: 'hi' }, now)
    p.update({ bio: null }, now)
    expect(p.displayName).toBe('Jane')
    expect(p.bio).toBeNull()
  })

  test('changeAvatar records old and new key', () => {
    const p = fresh()
    p.changeAvatar('u1/a.png', now)
    p.pullEvents()
    p.changeAvatar('u1/b.png', now)
    const [event] = p.pullEvents()
    expect(event?.type).toBe(ProfileEvents.AvatarChanged)
    expect(event?.payload).toMatchObject({ oldKey: 'u1/a.png', newKey: 'u1/b.png' })
  })

  test('changeCover records old and new key and leaves the avatar alone', () => {
    const p = fresh()
    p.changeAvatar('u1/a.png', now)
    p.changeCover('u1/cover/a.png', now)
    p.pullEvents()
    p.changeCover('u1/cover/b.png', now)
    const [event] = p.pullEvents()
    expect(event?.type).toBe(ProfileEvents.CoverChanged)
    expect(event?.payload).toMatchObject({ oldKey: 'u1/cover/a.png', newKey: 'u1/cover/b.png' })
    expect(p.avatarKey).toBe('u1/a.png')
    expect(p.coverKey).toBe('u1/cover/b.png')
  })
})
