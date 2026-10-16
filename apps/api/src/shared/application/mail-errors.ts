import { RetryLaterError } from '#/shared/messaging/errors'

/** Nhà cung cấp mail (hoặc bộ giới hạn của mình) từ chối vì quá tốc độ/quota — thử lại sau là được. */
export class MailRateLimitedError extends RetryLaterError {}

/** Mail không bao giờ gửi được (địa chỉ không tồn tại, bị từ chối nội dung…) — retry vô ích. */
export class MailPermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailPermanentError'
  }
}
