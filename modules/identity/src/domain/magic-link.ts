import type { Locale } from '@app/shared-types/locales'
import { AggregateRoot } from '@kit/core'
import { IdentityEvents } from '../contracts/events'
import type { Email } from './email'

export const MAGIC_LINK_TTL_MS = 15 * 60_000
export const MAGIC_LINK_CODE_DIGITS = 6
/** Wrong codes a link tolerates before it stops accepting codes (the link itself still works). */
export const MAGIC_LINK_CODE_MAX_ATTEMPTS = 5

export class MagicLink extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    readonly email: Email,
    readonly tokenHash: string,
    readonly codeHash: string | null,
    readonly requestedIp: string,
    readonly createdAt: Date,
    readonly expiresAt: Date,
    readonly consumedAt: Date | null,
  ) {
    super(id, version)
  }

  /** `rawToken` and `rawCode` go only into the event (to send the mail); the aggregate keeps just their hashes. */
  static issue(params: {
    id: string
    email: Email
    rawToken: string
    tokenHash: string
    /** The same sign-in as a code to type, for when the mail is read on another device. */
    rawCode: string
    codeHash: string
    requestedIp: string
    /** Language of the mail; it goes only into the event. */
    locale: Locale
    now: Date
  }): MagicLink {
    const expiresAt = new Date(params.now.getTime() + MAGIC_LINK_TTL_MS)
    const link = new MagicLink(
      params.id,
      0,
      params.email,
      params.tokenHash,
      params.codeHash,
      params.requestedIp,
      params.now,
      expiresAt,
      null,
    )
    link.record(
      IdentityEvents.MagicLinkRequested,
      {
        email: params.email.value,
        token: params.rawToken,
        code: params.rawCode,
        locale: params.locale,
        expiresAt: expiresAt.toISOString(),
      },
      params.now,
    )
    return link
  }

  static restore(params: {
    id: string
    version: number
    email: Email
    tokenHash: string
    codeHash?: string | null
    requestedIp: string
    createdAt: Date
    expiresAt: Date
    consumedAt: Date | null
  }): MagicLink {
    return new MagicLink(
      params.id,
      params.version,
      params.email,
      params.tokenHash,
      params.codeHash ?? null,
      params.requestedIp,
      params.createdAt,
      params.expiresAt,
      params.consumedAt,
    )
  }
}
