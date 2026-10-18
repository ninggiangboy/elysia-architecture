import {
  COVER_CONTENT_TYPES,
  COVER_MAX_BYTES,
  type CoverContentType,
} from '@app/shared-types/profile'
import type { IdGenerator } from '#/shared/core'
import { ValidationError } from '#/shared/core'
import type { ObjectStorage } from '#/shared/storage'
import { coverKeyPrefix } from '../cover-keys'

const UPLOAD_URL_TTL_SECONDS = 300

export interface CoverUploadTicket {
  uploadUrl: string
  key: string
  method: 'PUT'
  headers: Record<string, string>
  expiresIn: number
}

/** Same flow as the avatar: the browser PUTs straight to S3, so image bytes never pass through the API. */
export class RequestCoverUpload {
  constructor(
    private storage: ObjectStorage,
    private ids: IdGenerator,
  ) {}

  execute(cmd: { userId: string; contentType: string; contentLength: number }): CoverUploadTicket {
    if (!(cmd.contentType in COVER_CONTENT_TYPES)) {
      throw new ValidationError(
        'unsupported_cover_type',
        'Cover image must be a JPEG, PNG or WebP image',
      )
    }
    if (cmd.contentLength <= 0 || cmd.contentLength > COVER_MAX_BYTES) {
      throw new ValidationError(
        'cover_too_large',
        `Cover image must be at most ${COVER_MAX_BYTES / 1024 / 1024} MB`,
      )
    }
    const ext = COVER_CONTENT_TYPES[cmd.contentType as CoverContentType]
    const key = `${coverKeyPrefix(cmd.userId)}${this.ids.next()}.${ext}`
    return {
      uploadUrl: this.storage.presignPut(key, {
        contentType: cmd.contentType,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      }),
      key,
      method: 'PUT',
      headers: { 'Content-Type': cmd.contentType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    }
  }
}
