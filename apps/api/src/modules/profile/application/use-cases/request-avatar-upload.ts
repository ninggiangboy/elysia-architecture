import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  type AvatarContentType,
} from '@app/shared-types/profile'
import type { IdGenerator } from '@kit/core'
import { ValidationError } from '@kit/core'
import type { ObjectStorage } from '#/shared/storage'

const UPLOAD_URL_TTL_SECONDS = 300

export interface AvatarUploadTicket {
  uploadUrl: string
  key: string
  method: 'PUT'
  headers: Record<string, string>
  expiresIn: number
}

/** Issues a presigned URL so the browser PUTs straight to S3 — image bytes never pass through the API. */
export class RequestAvatarUpload {
  constructor(
    private storage: ObjectStorage,
    private ids: IdGenerator,
  ) {}

  execute(cmd: { userId: string; contentType: string; contentLength: number }): AvatarUploadTicket {
    if (!(cmd.contentType in AVATAR_CONTENT_TYPES)) {
      throw new ValidationError(
        'unsupported_avatar_type',
        'Avatar must be a JPEG, PNG or WebP image',
      )
    }
    if (cmd.contentLength <= 0 || cmd.contentLength > AVATAR_MAX_BYTES) {
      throw new ValidationError(
        'avatar_too_large',
        `Avatar must be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`,
      )
    }
    const ext = AVATAR_CONTENT_TYPES[cmd.contentType as AvatarContentType]
    const key = `${cmd.userId}/${this.ids.next()}.${ext}`
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
