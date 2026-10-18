import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ObjectStorage } from '@kit/storage'

export interface ObjectStorageUnderTest {
  storage: ObjectStorage
  cleanup?(): Promise<void>
}

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)
/** `text/plain;charset=utf-8` and `text/plain` name the same type: a store may add parameters, it may not change the type. */
const mediaType = (contentType: string | undefined) => contentType?.split(';')[0]?.trim()

/**
 * What every ObjectStorage must do, whatever it is backed by (S3, the local disk, a fake). Run it on each adapter: if a fake
 * behaves differently from the real thing, one of the two runs is red.
 */
export function describeObjectStorage(
  name: string,
  make: () => Promise<ObjectStorageUnderTest> | ObjectStorageUnderTest,
) {
  describe(`ObjectStorage contract: ${name}`, () => {
    let sut: ObjectStorageUnderTest
    let prefix: string
    const key = (name: string) => `${prefix}${name}`

    beforeEach(async () => {
      sut = await make()
      prefix = `contract/${crypto.randomUUID()}/`
    })
    afterEach(async () => {
      await sut.storage.deletePrefix(prefix)
      await sut.cleanup?.()
    })

    test('what is written is read back byte for byte, with its size and content type', async () => {
      const data = text('héllo wörld ✓')
      await sut.storage.write(key('a.txt'), data, 'text/plain')
      expect(await sut.storage.read(key('a.txt'))).toEqual(data)
      const stat = await sut.storage.stat(key('a.txt'))
      expect(stat?.size).toBe(data.byteLength)
      expect(mediaType(stat?.contentType)).toBe('text/plain')
    })

    test('binary data survives: every byte value', async () => {
      const data = Uint8Array.from({ length: 256 }, (_, i) => i)
      await sut.storage.write(key('all-bytes'), data, 'application/octet-stream')
      expect(await sut.storage.read(key('all-bytes'))).toEqual(data)
    })

    test('writing again replaces the content and the content type', async () => {
      await sut.storage.write(key('x'), text('first'), 'text/plain')
      await sut.storage.write(key('x'), bytes(1, 2, 3), 'application/octet-stream')
      expect(await sut.storage.read(key('x'))).toEqual(bytes(1, 2, 3))
      const stat = await sut.storage.stat(key('x'))
      expect(stat?.size).toBe(3)
      expect(mediaType(stat?.contentType)).toBe('application/octet-stream')
    })

    test('an object that is not there reads and stats as null', async () => {
      expect(await sut.storage.read(key('missing'))).toBeNull()
      expect(await sut.storage.stat(key('missing'))).toBeNull()
    })

    test('delete removes the object, and deleting what is not there is fine', async () => {
      await sut.storage.write(key('gone'), text('x'), 'text/plain')
      await sut.storage.delete(key('gone'))
      expect(await sut.storage.stat(key('gone'))).toBeNull()
      await sut.storage.delete(key('gone'))
      await sut.storage.delete(key('never-existed'))
    })

    test('deletePrefix removes everything under the prefix, counts it and touches nothing else', async () => {
      for (const name of ['d/1', 'd/2', 'd/sub/3'])
        await sut.storage.write(key(name), text(name), 'text/plain')
      await sut.storage.write(key('dx/keep'), text('keep'), 'text/plain')
      await sut.storage.write(key('other'), text('keep'), 'text/plain')

      expect(await sut.storage.deletePrefix(key('d/'))).toBe(3)

      expect(await sut.storage.stat(key('d/1'))).toBeNull()
      expect(await sut.storage.stat(key('d/sub/3'))).toBeNull()
      expect(await sut.storage.stat(key('dx/keep'))).not.toBeNull()
      expect(await sut.storage.stat(key('other'))).not.toBeNull()
      // Idempotent: nothing left to delete is not an error.
      expect(await sut.storage.deletePrefix(key('d/'))).toBe(0)
    })

    test('deletePrefix walks a prefix of many objects', async () => {
      const names = Array.from({ length: 25 }, (_, i) => `many/${i}`)
      await Promise.all(names.map((n) => sut.storage.write(key(n), text(n), 'text/plain')))
      expect(await sut.storage.deletePrefix(key('many/'))).toBe(25)
      expect(await sut.storage.stat(key('many/0'))).toBeNull()
    })

    test('presigned links are absolute URLs that name the object', () => {
      const put = sut.storage.presignPut(key('up.png'), {
        contentType: 'image/png',
        expiresInSeconds: 60,
      })
      const get = sut.storage.presignGet(key('up.png'), 60)
      for (const link of [put, get]) {
        const url = new URL(link)
        expect(decodeURIComponent(url.pathname)).toContain(key('up.png'))
      }
    })
  })
}
