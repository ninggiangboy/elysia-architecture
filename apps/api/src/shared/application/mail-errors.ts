import { RetryLaterError } from '#/shared/messaging/errors'

/** The mail provider (or our own limiter) refused because of rate/quota — retrying later is fine. */
export class MailRateLimitedError extends RetryLaterError {}

/** The mail can never be sent (address does not exist, content rejected…) — retrying is pointless. */
export class MailPermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailPermanentError'
  }
}
