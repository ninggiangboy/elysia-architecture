import type { StorageConfig } from './config'
import { LocalFsObjectStorage } from './local-fs-object-storage'
import type { ObjectStorage } from './ports'
import { S3ObjectStorage } from './s3-object-storage'

/** The storage the configuration asks for (`STORAGE_DRIVER`). The slice has already checked that its variables are set. */
export function createObjectStorage(config: StorageConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === 'local') {
    if (!config.STORAGE_LOCAL_SECRET) throw new Error('STORAGE_LOCAL_SECRET is required')
    return new LocalFsObjectStorage({
      dir: config.STORAGE_LOCAL_DIR,
      publicUrl: config.STORAGE_LOCAL_PUBLIC_URL,
      secret: config.STORAGE_LOCAL_SECRET,
    })
  }
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new Error(
      'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required',
    )
  return new S3ObjectStorage({
    endpoint: S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT ?? S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  })
}
