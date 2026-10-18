import { S3Client } from 'bun'
import type { ObjectStat, ObjectStorage } from './ports'

export interface S3Options {
  endpoint: string
  /** Endpoint reachable from the BROWSER (the presigned signature is bound to this host). */
  publicEndpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly internal: S3Client
  private readonly signer: S3Client

  constructor(options: S3Options) {
    const base = {
      region: options.region,
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    }
    this.internal = new S3Client({ ...base, endpoint: options.endpoint })
    // Presigning only computes the signature locally, no network call.
    this.signer = new S3Client({ ...base, endpoint: options.publicEndpoint })
  }

  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string {
    return this.signer.file(key).presign({
      method: 'PUT',
      expiresIn: opts.expiresInSeconds,
      type: opts.contentType,
    })
  }

  presignGet(key: string, expiresInSeconds: number): string {
    return this.signer.file(key).presign({ method: 'GET', expiresIn: expiresInSeconds })
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const s = await this.internal.file(key).stat()
      return { size: s.size, contentType: s.type }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw err
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return await this.internal.file(key).bytes()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw err
    }
  }

  async write(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.internal.file(key).write(data, { type: contentType })
  }

  async delete(key: string): Promise<void> {
    await this.internal.file(key).delete()
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0
    // Deleted keys drop out of the listing, so asking for the first page again each time walks the whole prefix.
    for (;;) {
      const page = await this.internal.list({ prefix, maxKeys: 500 })
      const keys = (page.contents ?? []).map((object) => object.key)
      if (keys.length === 0) return deleted
      await Promise.all(keys.map((key) => this.internal.file(key).delete()))
      deleted += keys.length
      if (!page.isTruncated) return deleted
    }
  }
}
