import { beforeEach, describe, expect, test } from 'bun:test'
import { AVATAR_MAX_BYTES, COVER_MAX_BYTES } from '@app/shared-types/profile'
import type { IdentityApi } from '#/modules/identity/contracts'
import { VersionConflictError } from '#/shared/core'
import {
  FakeClock,
  FakeStorage,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing'
import { ProfileEvents } from '../contracts/events'
import type { Profile } from '../domain/profile'
import type { ProfileRepository } from '../domain/profile-repository'
import { ProfileLoader } from './profile-loader'
import { RequestAvatarUpload } from './use-cases/request-avatar-upload'
import { RequestCoverUpload } from './use-cases/request-cover-upload'
import { SetAvatar } from './use-cases/set-avatar'
import { SetCover } from './use-cases/set-cover'
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
    id === 'ghost'
      ? null
      : { id, email: `${id}@x.co`, locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
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

    test('SetAvatar refuses a cover image key', async () => {
      storage.objects.set('u1/cover/a.png', { size: 10, contentType: 'image/png' })
      await expect(
        setAvatar().execute({ userId: 'u1', key: 'u1/cover/a.png' }),
      ).rejects.toMatchObject({ code: 'invalid_avatar_key' })
    })
  })

  describe('cover', () => {
    const request = () => new RequestCoverUpload(storage, new SequentialIds())
    const setCover = () =>
      new SetCover(loader, profiles, storage, outbox, new PassthroughUnitOfWork(), clock)

    test("upload ticket is scoped to the user's cover folder and validates type and size", () => {
      const ticket = request().execute({
        userId: 'u1',
        contentType: 'image/webp',
        contentLength: AVATAR_MAX_BYTES + 1, // over the avatar limit, within the cover one
      })
      expect(ticket.key).toMatch(/^u1\/cover\/.+\.webp$/)
      expect(() =>
        request().execute({ userId: 'u1', contentType: 'image/gif', contentLength: 10 }),
      ).toThrow('JPEG, PNG or WebP')
      expect(() =>
        request().execute({
          userId: 'u1',
          contentType: 'image/png',
          contentLength: COVER_MAX_BYTES + 1,
        }),
      ).toThrow('at most')
      expect(() =>
        request().execute({ userId: 'u1', contentType: 'image/png', contentLength: 0 }),
      ).toThrow()
    })

    test('SetCover rejects keys outside the cover folder and files that were never uploaded', async () => {
      for (const key of ['u2/cover/x.png', 'u1/x.png', 'u1/cover/../../u2/x.png'])
        await expect(setCover().execute({ userId: 'u1', key })).rejects.toMatchObject({
          code: 'invalid_cover_key',
        })
      await expect(
        setCover().execute({ userId: 'u1', key: 'u1/cover/x.png' }),
      ).rejects.toMatchObject({ code: 'cover_not_uploaded' })
    })

    test('SetCover deletes uploads that violate size/type', async () => {
      storage.objects.set('u1/cover/big.png', {
        size: COVER_MAX_BYTES + 1,
        contentType: 'image/png',
      })
      await expect(
        setCover().execute({ userId: 'u1', key: 'u1/cover/big.png' }),
      ).rejects.toMatchObject({ code: 'invalid_cover' })
      expect(storage.deleted).toEqual(['u1/cover/big.png'])
      storage.objects.set('u1/cover/evil.html', { size: 10, contentType: 'text/html' })
      await expect(
        setCover().execute({ userId: 'u1', key: 'u1/cover/evil.html' }),
      ).rejects.toMatchObject({ code: 'invalid_cover' })
    })

    test('SetCover swaps the cover, keeps the avatar, and emits an event carrying the old key', async () => {
      storage.objects.set('u1/a.png', { size: 10, contentType: 'image/png' })
      storage.objects.set('u1/cover/a.png', { size: 10, contentType: 'image/png' })
      storage.objects.set('u1/cover/b.png', { size: 10, contentType: 'image/png' })
      await new SetAvatar(
        loader,
        profiles,
        storage,
        outbox,
        new PassthroughUnitOfWork(),
        clock,
      ).execute({ userId: 'u1', key: 'u1/a.png' })
      await setCover().execute({ userId: 'u1', key: 'u1/cover/a.png' })
      const view = await setCover().execute({ userId: 'u1', key: 'u1/cover/b.png' })
      expect(view.coverUrl).toContain('u1/cover/b.png')
      expect(view.avatarUrl).toContain('u1/a.png')
      expect(outbox.types()).toEqual([
        ProfileEvents.AvatarChanged,
        ProfileEvents.CoverChanged,
        ProfileEvents.CoverChanged,
      ])
      expect(outbox.events[2]?.payload).toMatchObject({
        oldKey: 'u1/cover/a.png',
        newKey: 'u1/cover/b.png',
      })
    })
  })
})
