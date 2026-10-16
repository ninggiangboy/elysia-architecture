import { beforeEach, describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import type { InboxGuard } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import { FakeStorage } from '#/shared/testing/fakes'
import { ProfileEvents } from '../contracts/events'
import { SharpImageResizer } from '../infrastructure/sharp-image-resizer'
import { avatarThumbnailKey, avatarThumbnailKeys } from './avatar-thumbnails'
import { DeleteOldAvatar } from './handlers/delete-old-avatar'
import { GenerateAvatarThumbnails } from './handlers/generate-avatar-thumbnails'
import { type ImageResizer, UnprocessableImageError } from './ports'

class InMemoryInbox implements InboxGuard {
  private seen = new Set<string>()
  async transactional(messageId: string, handler: string, fn: () => Promise<void>) {
    const key = `${messageId}:${handler}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    await fn()
  }
  async afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>) {
    return this.transactional(messageId, handler, fn)
  }
}

const message = (id: string, payload: Record<string, unknown>): Envelope => ({
  id,
  type: ProfileEvents.AvatarChanged,
  source: 'profile',
  aggregateId: 'u1',
  occurredAt: '2026-01-01T00:00:00Z',
  payload: { userId: 'u1', oldKey: null, newKey: 'u1/a.png', changedAt: '', ...payload },
  headers: {},
})

const silent = { info() {}, warn() {}, error() {} }

describe('avatar thumbnails', () => {
  let storage: FakeStorage
  let png: Uint8Array
  let resizer: SharpImageResizer & { calls: number }

  beforeEach(async () => {
    storage = new FakeStorage()
    png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#3366ff' },
    })
      .png()
      .toBuffer()
    resizer = Object.assign(new SharpImageResizer(), { calls: 0 })
    const square = resizer.square.bind(resizer)
    resizer.square = (...args) => {
      resizer.calls++
      return square(...args)
    }
  })

  const handler = (r: ImageResizer = resizer) =>
    new GenerateAvatarThumbnails(storage, r, new InMemoryInbox(), silent)

  test('derives thumbnail keys from the avatar key', () => {
    expect(avatarThumbnailKey('u1/abc.png', 256)).toBe('u1/abc.256.webp')
    expect(avatarThumbnailKey('u1/noext', 64)).toBe('u1/noext.64.webp')
    expect(avatarThumbnailKey('u.1/noext', 64)).toBe('u.1/noext.64.webp')
  })

  test('writes a square webp of every size', async () => {
    await storage.write('u1/a.png', png, 'image/png')
    await handler().handle(message('m1', {}))
    for (const [size, key] of [
      [64, 'u1/a.64.webp'],
      [256, 'u1/a.256.webp'],
    ] as const) {
      const bytes = storage.data.get(key)
      expect(bytes).toBeDefined()
      const meta = await sharp(bytes).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', size, size])
    }
    expect(storage.objects.get('u1/a.64.webp')?.contentType).toBe('image/webp')
  })

  test('a redelivery or a second message for the same avatar does no work', async () => {
    await storage.write('u1/a.png', png, 'image/png')
    const h = handler()
    await h.handle(message('m1', {}))
    await h.handle(message('m1', {})) // same message: inbox
    await h.handle(message('m2', {})) // new message, thumbnails already there: stat
    expect(resizer.calls).toBe(2)
  })

  test('only makes the thumbnails that are missing', async () => {
    await storage.write('u1/a.png', png, 'image/png')
    await storage.write('u1/a.64.webp', new Uint8Array([1]), 'image/webp')
    await handler().handle(message('m1', {}))
    expect(resizer.calls).toBe(1)
    expect(storage.data.get('u1/a.64.webp')).toEqual(new Uint8Array([1]))
    expect(storage.data.has('u1/a.256.webp')).toBe(true)
  })

  test('does nothing when the avatar is already gone', async () => {
    await handler().handle(message('m1', {}))
    expect(resizer.calls).toBe(0)
    expect(storage.data.size).toBe(0)
  })

  test('swallows an undecodable image instead of retrying it forever', async () => {
    await storage.write('u1/a.png', new TextEncoder().encode('not an image'), 'image/png')
    await handler().handle(message('m1', {}))
    expect(storage.data.has('u1/a.64.webp')).toBe(false)
  })

  test('rethrows anything else so the relay retries', async () => {
    await storage.write('u1/a.png', png, 'image/png')
    const flaky: ImageResizer = {
      square: async () => {
        throw new Error('s3 hiccup')
      },
    }
    await expect(handler(flaky).handle(message('m1', {}))).rejects.toThrow('s3 hiccup')
  })

  test('the resizer reports a bad source as unprocessable', async () => {
    await expect(
      new SharpImageResizer().square(new Uint8Array([1, 2, 3]), 64),
    ).rejects.toBeInstanceOf(UnprocessableImageError)
  })

  test('replacing an avatar deletes the old file together with its thumbnails', async () => {
    await new DeleteOldAvatar(storage, new InMemoryInbox()).handle(
      message('m1', { oldKey: 'u1/a.png', newKey: 'u1/b.png' }),
    )
    expect(storage.deleted.sort()).toEqual(['u1/a.png', ...avatarThumbnailKeys('u1/a.png')].sort())
  })
})
