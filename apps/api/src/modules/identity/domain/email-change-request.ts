import { AggregateRoot } from '#/shared/domain/aggregate-root'
import { IdentityEvents } from '../contracts/events'
import type { Email } from './email'

export const EMAIL_CHANGE_TTL_MS = 30 * 60_000

export class EmailChangeRequest extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    readonly userId: string,
    readonly newEmail: Email,
    readonly tokenHash: string,
    readonly createdAt: Date,
    readonly expiresAt: Date,
    readonly consumedAt: Date | null,
  ) {
    super(id, version)
  }

  static issue(params: {
    id: string
    userId: string
    newEmail: Email
    rawToken: string
    tokenHash: string
    now: Date
  }): EmailChangeRequest {
    const expiresAt = new Date(params.now.getTime() + EMAIL_CHANGE_TTL_MS)
    const request = new EmailChangeRequest(
      params.id,
      0,
      params.userId,
      params.newEmail,
      params.tokenHash,
      params.now,
      expiresAt,
      null,
    )
    request.record(
      IdentityEvents.EmailChangeRequested,
      {
        userId: params.userId,
        newEmail: params.newEmail.value,
        token: params.rawToken,
        expiresAt: expiresAt.toISOString(),
      },
      params.now,
    )
    return request
  }

  static restore(params: {
    id: string
    version: number
    userId: string
    newEmail: Email
    tokenHash: string
    createdAt: Date
    expiresAt: Date
    consumedAt: Date | null
  }): EmailChangeRequest {
    return new EmailChangeRequest(
      params.id,
      params.version,
      params.userId,
      params.newEmail,
      params.tokenHash,
      params.createdAt,
      params.expiresAt,
      params.consumedAt,
    )
  }
}
