import { AggregateRoot } from '#/shared/domain/aggregate-root'
import { IdentityEvents } from '../contracts/events'
import type { Email } from './email'

export const MAGIC_LINK_TTL_MS = 15 * 60_000

export class MagicLink extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    readonly email: Email,
    readonly tokenHash: string,
    readonly requestedIp: string,
    readonly createdAt: Date,
    readonly expiresAt: Date,
    readonly consumedAt: Date | null,
  ) {
    super(id, version)
  }

  /** `rawToken` chỉ đi vào event (để gửi mail); aggregate chỉ giữ hash. */
  static issue(params: {
    id: string
    email: Email
    rawToken: string
    tokenHash: string
    requestedIp: string
    now: Date
  }): MagicLink {
    const expiresAt = new Date(params.now.getTime() + MAGIC_LINK_TTL_MS)
    const link = new MagicLink(
      params.id,
      0,
      params.email,
      params.tokenHash,
      params.requestedIp,
      params.now,
      expiresAt,
      null,
    )
    link.record(
      IdentityEvents.MagicLinkRequested,
      { email: params.email.value, token: params.rawToken, expiresAt: expiresAt.toISOString() },
      params.now,
    )
    return link
  }

  static restore(params: {
    id: string
    version: number
    email: Email
    tokenHash: string
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
      params.requestedIp,
      params.createdAt,
      params.expiresAt,
      params.consumedAt,
    )
  }
}
