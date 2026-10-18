import { DomainError } from '@kit/core'

export const MAX_REPLY_LENGTH = 200

/** What the module answers a ping with: a non-empty text of a sane length. */
export class Reply {
  private constructor(readonly text: string) {}

  static of(text: string): Reply {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > MAX_REPLY_LENGTH)
      throw new DomainError(
        'invalid_reply',
        `A reply has 1-${MAX_REPLY_LENGTH} characters`,
        'validation',
      )
    return new Reply(trimmed)
  }
}
