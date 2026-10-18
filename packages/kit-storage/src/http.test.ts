import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorHandlerPlugin } from '@kit/http'
import { Elysia } from 'elysia'
import { localStoragePlugin } from './http'
import { LocalFsObjectStorage } from './local-fs-object-storage'
import { S3ObjectStorage } from './s3-object-storage'

const SECRET = 'x'.repeat(40)
const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  fatal() {},
  trace() {},
  child() {
    return log
  },
}

async function setup(now = () => new Date()) {
  const dir = await mkdtemp(join(tmpdir(), 'kit-storage-'))
  const storage = new LocalFsObjectStorage({
    dir,
    publicUrl: 'http://api.test/api',
    secret: SECRET,
    now,
  })
  const app = new Elysia({ prefix: '/api' })
    .use(errorHandlerPlugin(log as never))
    .use(localStoragePlugin(storage, { maxBytes: 1024 }))
  const call = (url: string, init?: RequestInit) => app.handle(new Request(url, init))
  return { storage, call, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('local storage links', () => {
  test('an upload through a presigned link is served back through a presigned link', async () => {
    const { storage, call, cleanup } = await setup()
    const put = storage.presignPut('avatars/u1/a.png', {
      contentType: 'image/png',
      expiresInSeconds: 60,
    })
    const res = await call(put, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(res.status).toBe(200)
    expect(await storage.stat('avatars/u1/a.png')).toEqual({ size: 3, contentType: 'image/png' })

    const got = await call(storage.presignGet('avatars/u1/a.png', 60))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    await cleanup()
  })

  test('a tampered, expired or wrong-method link is refused', async () => {
    let now = new Date('2026-01-01T00:00:00Z')
    const { storage, call, cleanup } = await setup(() => now)
    await storage.write('f.txt', new TextEncoder().encode('x'), 'text/plain')
    const get = storage.presignGet('f.txt', 60)

    expect((await call(get)).status).toBe(200)
    expect((await call(get.replace('f.txt', 'g.txt'))).status).toBe(403)
    expect((await call(get.replace(/signature=[^&]+/, 'signature=nope'))).status).toBe(403)
    expect((await call(get, { method: 'PUT', body: 'x' })).status).toBe(403) // a GET link cannot upload
    now = new Date(now.getTime() + 61_000)
    expect((await call(get)).status).toBe(403)
    await cleanup()
  })

  test('an upload must declare the content type it was granted, and fit the size limit', async () => {
    const { storage, call, cleanup } = await setup()
    const put = storage.presignPut('a.png', { contentType: 'image/png', expiresInSeconds: 60 })
    expect(
      (await call(put, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: 'x' }))
        .status,
    ).toBe(403)
    const big = new Uint8Array(2048)
    expect(
      (await call(put, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: big }))
        .status,
    ).toBe(403)
    expect(await storage.stat('a.png')).toBeNull()
    await cleanup()
  })

  test('keys cannot leave the storage folder', async () => {
    const { storage, cleanup } = await setup()
    expect(() => storage.presignGet('../outside', 60)).toThrow('Invalid object key')
    await expect(storage.write('a/../../b', new Uint8Array(), 'text/plain')).rejects.toThrow(
      'Invalid object key',
    )
    await cleanup()
  })

  test('with another storage the routes answer 404', async () => {
    const s3 = new S3ObjectStorage({
      endpoint: 'http://s3.test',
      publicEndpoint: 'http://s3.test',
      region: 'x',
      bucket: 'b',
      accessKeyId: 'a',
      secretAccessKey: 's',
    })
    const app = new Elysia({ prefix: '/api' })
      .use(errorHandlerPlugin(log as never))
      .use(localStoragePlugin(s3))
    expect(
      (await app.handle(new Request('http://api.test/api/storage/local/a?expires=1&signature=x')))
        .status,
    ).toBe(404)
  })
})
