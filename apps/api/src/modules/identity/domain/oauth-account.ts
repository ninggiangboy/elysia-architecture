import { AggregateRoot } from '#/shared/core'
import { IdentityEvents } from '../contracts/events'

const OAUTH_PROVIDERS = ['google', 'github'] as const
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]

export const isOAuthProvider = (value: string): value is OAuthProviderId =>
  (OAUTH_PROVIDERS as readonly string[]).includes(value)

/** An external identity (Google / GitHub account) that can sign its owner in. */
export class OAuthAccount extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    readonly userId: string,
    readonly provider: OAuthProviderId,
    /** The provider's stable id for the person (`sub` / numeric user id) — never the email, which can change. */
    readonly providerUserId: string,
    readonly email: string | null,
    readonly createdAt: Date,
  ) {
    super(id, version)
  }

  static link(params: {
    id: string
    userId: string
    provider: OAuthProviderId
    providerUserId: string
    email: string | null
    now: Date
  }): OAuthAccount {
    const account = new OAuthAccount(
      params.id,
      0,
      params.userId,
      params.provider,
      params.providerUserId,
      params.email,
      params.now,
    )
    account.record(
      IdentityEvents.OAuthAccountLinked,
      {
        userId: params.userId,
        provider: params.provider,
        email: params.email,
        linkedAt: params.now.toISOString(),
      },
      params.now,
    )
    return account
  }

  static restore(params: {
    id: string
    userId: string
    provider: OAuthProviderId
    providerUserId: string
    email: string | null
    createdAt: Date
  }): OAuthAccount {
    return new OAuthAccount(
      params.id,
      1,
      params.userId,
      params.provider,
      params.providerUserId,
      params.email,
      params.createdAt,
    )
  }
}
