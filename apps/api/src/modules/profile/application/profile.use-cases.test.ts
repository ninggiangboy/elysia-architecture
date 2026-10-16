import { beforeEach, describe, expect, test } from 'bun:test'
import { AVATAR_MAX_BYTES } from '@app/shared-types'
import type { IdentityApi } from '#/modules/identity/contracts'
import { VersionConflictError } from '#/shared/application/errors'
import {
  FakeClock,
  FakeStorage,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing/fakes'
import { ProfileEvents } from '../contracts/events'
import type { Profile } from '../domain/profile'
import type { ProfileRepository } from '../domain/profile-repository'
import { ProfileLoader } from './profile-loader'
import { RequestAvatarUpload } from './use-cases/request-avatar-upload'
import { SetAvatar } from './use-cases/set-avatar'
import { UpdateProfile } from './use-cases/update-profile'

class MemProfiles implements ProfileRepository {
  rows = new Map<string, Profile>()
  async findByUserId(id: string) {
    return this.rows.get(id) ?? null
  }
  async save(p: Profile) {
    p.version += 1
    this.rows.set(p.userId, p)
  }
  async createIfAbsent(p: Profile) {
    if (this.rows.has(p.userId)) return false
    this.rows.set(p.userId, p)
    return true
  }
}

const identity: IdentityApi = {
  getAccount: async (id) =>
    id === 'ghost' ? null : { id, email: `${id}@x.co`, createdAt: '2026-01-01T00:00:00.000Z' },
}

describe('profile use cases', () => {
  let profiles: MemProfiles
  let storage: FakeStorage
  let outbox: InMemoryOutbox
  let clock: FakeClock
  let loader: ProfileLoader

  beforeEach(() => {
    profiles = new MemProfiles()
    storage = new FakeStorage()
    outbox = new InMemoryOutbox()
    clock = new FakeClock()
    loader = new ProfileLoader(identity, profiles, clock)
  })

  test('UpdateProfile creates the profile lazily when the welcome event has not been processed yet', async () => {
    const view = await new UpdateProfile(loader, profiles, storage, clock).execute({
      userId: 'u1',
      displayName: 'An',
    })
    expect(view.displayName).toBe('An')
    expect(view.version).toBe(1)
    expect(profiles.rows.has('u1')).toBe(true)
  })

  test('UpdateProfile honours expectedVersion (If-Match)', async () => {
    const update = new UpdateProfile(loader, profiles, storage, clock)
    await update.execute({ userId: 'u1', displayName: 'An' })
    await expect(
      update.execute({ userId: 'u1', displayName: 'B', expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(VersionConflictError)
    await expect(
      update.execute({ userId: 'u1', displayName: 'B', expectedVersion: 1 }),
    ).resolves.toMatchObject({ version: 2 })
  })

  test('unknown users are 404', async () => {
    await expect(
      new UpdateProfile(loader, profiles, storage, clock).execute({
        userId: 'ghost',
        displayName: 'x',
      }),
    ).rejects.toMatchObject({
      code: 'user_not_found',
    })
  })

  describe('avatar', () => {
    const request = () => new RequestAvatarUpload(storage, new SequentialIds())
    const setAvatar = () =>
      new SetAvatar(loader, profiles, storage, outbox, new PassthroughUnitOfWork(), clock)

    test('upload ticket is scoped to the user and validates type and size', () => {
      const ticket = request().execute({
        userId: 'u1',
        contentType: 'image/webp',
        contentLength: 1000,
      })
      expect(ticket.key).toMatch(/^u1\/.+\.webp$/)
      expect(() =>
        request().execute({ userId: 'u1', contentType: 'image/gif', contentLength: 10 }),
      ).toThrow('JPEG, PNG or WebP')
      expect(() =>
        request().execute({
          userId: 'u1',
          contentType: 'image/png',
          contentLength: AVATAR_MAX_BYTES + 1,
        }),
      ).toThrow('at most')
      expect(() =>
        request().execute({ userId: 'u1', contentType: 'image/png', contentLength: 0 }),
      ).toThrow()
    })

    test('SetAvatar rejects keys outside the user prefix and files that were never uploaded', async () => {
      await expect(setAvatar().execute({ userId: 'u1', key: 'u2/x.png' })).rejects.toMatchObject({
        code: 'invalid_avatar_key',
      })
      await expect(
        setAvatar().execute({ userId: 'u1', key: 'u1/../u2/x.png' }),
      ).rejects.toMatchObject({ code: 'invalid_avatar_key' })
      await expect(setAvatar().execute({ userId: 'u1', key: 'u1/x.png' })).rejects.toMatchObject({
        code: 'avatar_not_uploaded',
      })
    })

    test('SetAvatar deletes uploads that violate size/type (presigned PUT cannot enforce them)', async () => {
      storage.objects.set('u1/big.png', { size: AVATAR_MAX_BYTES + 1, contentType: 'image/png' })
      await expect(setAvatar().execute({ userId: 'u1', key: 'u1/big.png' })).rejects.toMatchObject({
        code: 'invalid_avatar',
      })
      expect(storage.deleted).toEqual(['u1/big.png'])
      storage.objects.set('u1/evil.html', { size: 10, contentType: 'text/html' })
      await expect(
        setAvatar().execute({ userId: 'u1', key: 'u1/evil.html' }),
      ).rejects.toMatchObject({ code: 'invalid_avatar' })
    })

    test('SetAvatar swaps the avatar and emits an event carrying the old key for cleanup', async () => {
      storage.objects.set('u1/a.png', { size: 10, contentType: 'image/png' })
      storage.objects.set('u1/b.png', { size: 10, contentType: 'image/png' })
      await setAvatar().execute({ userId: 'u1', key: 'u1/a.png' })
      const view = await setAvatar().execute({ userId: 'u1', key: 'u1/b.png' })
      expect(view.avatarUrl).toContain('u1/b.png')
      expect(outbox.types()).toEqual([ProfileEvents.AvatarChanged, ProfileEvents.AvatarChanged])
      expect(outbox.events[1]?.payload).toMatchObject({ oldKey: 'u1/a.png', newKey: 'u1/b.png' })
    })
  })
})
