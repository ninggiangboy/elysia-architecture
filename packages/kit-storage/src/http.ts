import { ForbiddenError, NotFoundError } from '@kit/core'
import { Elysia } from 'elysia'
import { LocalFsObjectStorage } from './local-fs-object-storage'
import type { ObjectStorage } from './ports'

export interface LocalStorageRoutesOptions {
  /** Largest upload accepted. */
  maxBytes?: number
}

/**
 * The routes behind a `LocalFsObjectStorage`'s links: `PUT /storage/local/<key>` stores the body, `GET` serves it. The signature
 * and expiry in the query are the only authorization. With any other storage the routes exist but answer 404, so the app's
 * route types do not depend on the configuration.
 */
export function localStoragePlugin(
  storage: ObjectStorage,
  options: LocalStorageRoutesOptions = {},
) {
  const local = storage instanceof LocalFsObjectStorage ? storage : null
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024

  const claimOf = (
    method: 'GET' | 'PUT',
    key: string,
    query: Record<string, string | undefined>,
    contentType?: string,
  ) => {
    if (!local) throw new NotFoundError('route_not_found', 'Route not found')
    const expires = Number(query.expires)
    const claim = { method, key, expires, ...(method === 'PUT' ? { contentType } : {}) }
    if (!Number.isFinite(expires) || !query.signature || !local.verify(claim, query.signature))
      throw new ForbiddenError('invalid_link', 'This link is invalid or has expired')
    return local
  }

  return new Elysia({ name: 'local-storage', prefix: '/storage/local' })
    .put(
      '/*',
      async ({ params, query, request }) => {
        const key = params['*']
        const type = request.headers.get('content-type') ?? ''
        const store = claimOf('PUT', key, query, type)
        // The signature binds the content type: an upload may not declare another one than it was granted.
        if ((query.type ?? '') !== type)
          throw new ForbiddenError('invalid_link', 'This link is invalid or has expired')
        const body = new Uint8Array(await request.arrayBuffer())
        if (body.byteLength > maxBytes)
          throw new ForbiddenError('payload_too_large', 'The file is too large')
        await store.write(key, body, type)
        return new Response(null, { status: 200 })
      },
      { parse: 'none' },
    )
    .get('/*', async ({ params, query }) => {
      const key = params['*']
      const store = claimOf('GET', key, query)
      const [stat, bytes] = [await store.stat(key), await store.read(key)]
      if (!stat || !bytes) throw new NotFoundError('not_found', 'File not found')
      return new Response(bytes as unknown as ConstructorParameters<typeof Response>[0], {
        headers: { 'content-type': stat.contentType, 'cache-control': 'private, max-age=60' },
      })
    })
}
