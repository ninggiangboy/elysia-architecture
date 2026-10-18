import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { ObjectStat, ObjectStorage } from './ports'

export interface LocalFsOptions {
  /** Folder the files are written to. */
  dir: string
  /** Where browsers reach the API; links are `<publicUrl>/storage/local/<key>?…`. */
  publicUrl: string
  /** Signs the links. */
  secret: string
  now?: () => Date
}

export interface LinkClaim {
  method: 'GET' | 'PUT'
  key: string
  /** Unix seconds. */
  expires: number
  /** Only for PUT: the content type the upload must declare. */
  contentType?: string
}

/** Rejects keys that could leave the storage folder. */
function assertSafeKey(key: string) {
  const segments = key.split('/')
  if (!key || key.includes('\0') || segments.some((s) => s === '' || s === '.' || s === '..'))
    throw new Error(`Invalid object key: ${JSON.stringify(key)}`)
}

/**
 * Object storage on the local disk, for development and small deployments: no S3 service to run. "Presigned" links are
 * HMAC-signed URLs to the API's own `/storage/local/*` routes (`localStoragePlugin` in `@kit/storage/http`).
 * Not for several API servers: they would each see their own disk.
 */
export class LocalFsObjectStorage implements ObjectStorage {
  private readonly objects: string
  private readonly meta: string
  private readonly now: () => Date

  constructor(private options: LocalFsOptions) {
    this.objects = resolve(options.dir, 'objects')
    this.meta = resolve(options.dir, 'meta')
    this.now = options.now ?? (() => new Date())
  }

  private pathOf(root: string, key: string) {
    assertSafeKey(key)
    const path = join(root, ...key.split('/'))
    if (!path.startsWith(root + sep)) throw new Error(`Invalid object key: ${JSON.stringify(key)}`)
    return path
  }

  // ---- links -------------------------------------------------------------------------------------------------------

  private sign({ method, key, expires, contentType }: LinkClaim) {
    return createHmac('sha256', this.options.secret)
      .update(`${method}\n${key}\n${expires}\n${contentType ?? ''}`)
      .digest('base64url')
  }

  private link(claim: LinkClaim) {
    const path = claim.key.split('/').map(encodeURIComponent).join('/')
    const query = new URLSearchParams({ expires: String(claim.expires) })
    if (claim.contentType) query.set('type', claim.contentType)
    query.set('signature', this.sign(claim))
    return `${this.options.publicUrl.replace(/\/$/, '')}/storage/local/${path}?${query}`
  }

  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string {
    assertSafeKey(key)
    return this.link({
      method: 'PUT',
      key,
      contentType: opts.contentType,
      expires: Math.floor(this.now().getTime() / 1000) + opts.expiresInSeconds,
    })
  }

  presignGet(key: string, expiresInSeconds: number): string {
    assertSafeKey(key)
    return this.link({
      method: 'GET',
      key,
      expires: Math.floor(this.now().getTime() / 1000) + expiresInSeconds,
    })
  }

  /** Whether a link's claim was signed by us and has not expired. */
  verify(claim: LinkClaim, signature: string): boolean {
    if (claim.expires * 1000 < this.now().getTime()) return false
    const expected = Buffer.from(this.sign(claim))
    const given = Buffer.from(signature)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  // ---- objects -----------------------------------------------------------------------------------------------------

  async stat(key: string): Promise<ObjectStat | null> {
    const file = Bun.file(this.pathOf(this.objects, key))
    if (!(await file.exists())) return null
    return { size: file.size, contentType: await this.contentTypeOf(key) }
  }

  async read(key: string): Promise<Uint8Array | null> {
    const file = Bun.file(this.pathOf(this.objects, key))
    return (await file.exists()) ? await file.bytes() : null
  }

  async write(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const [path, metaPath] = [this.pathOf(this.objects, key), this.pathOf(this.meta, key)]
    await mkdir(dirname(path), { recursive: true })
    await mkdir(dirname(metaPath), { recursive: true })
    await Bun.write(path, data)
    await Bun.write(metaPath, JSON.stringify({ contentType }))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(this.objects, key), { force: true })
    await rm(this.pathOf(this.meta, key), { force: true })
  }

  async deletePrefix(prefix: string): Promise<number> {
    let entries: string[]
    try {
      entries = await readdir(this.objects, { recursive: true })
    } catch {
      return 0 // nothing was ever written
    }
    const keys: string[] = []
    for (const entry of entries) {
      const key = entry.split(sep).join('/')
      if (key.startsWith(prefix) && (await Bun.file(join(this.objects, entry)).exists()))
        keys.push(key)
    }
    await Promise.all(keys.map((key) => this.delete(key)))
    return keys.length
  }

  private async contentTypeOf(key: string): Promise<string> {
    try {
      const meta = (await Bun.file(this.pathOf(this.meta, key)).json()) as { contentType?: string }
      return meta.contentType ?? 'application/octet-stream'
    } catch {
      return 'application/octet-stream'
    }
  }
}
