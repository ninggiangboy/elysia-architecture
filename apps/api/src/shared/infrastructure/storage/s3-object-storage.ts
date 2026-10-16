import { S3Client } from 'bun'
import type { ObjectStat, ObjectStorage } from '#/shared/application/ports'

export interface S3Options {
  endpoint: string
  /** Endpoint mà TRÌNH DUYỆT truy cập được (chữ ký presigned gắn với host này). */
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
    // Presign chỉ tính chữ ký cục bộ, không gọi mạng.
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

  async delete(key: string): Promise<void> {
    await this.internal.file(key).delete()
  }
}
