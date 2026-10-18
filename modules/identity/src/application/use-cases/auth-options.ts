import { NotFoundError } from '@kit/core'
import type { UserRepository } from '../../domain/repositories'
import type { AuthPolicy } from '../auth-policy'
import type { OAuthGateway } from '../ports'
import type { GetTwoFactorStatus, TwoFactorStatus } from './two-factor'

/** What the sign-in and sign-up pages should offer, in one call (the pages need it before anyone is known). */
export class GetAuthOptions {
  constructor(
    private policy: AuthPolicy,
    private gateway: OAuthGateway,
  ) {}

  execute() {
    return {
      ...this.policy.describe(),
      providers: this.gateway.enabledProviders(),
      providerNames: this.gateway.providerNames?.() ?? {},
    }
  }
}

export interface SecuritySummary {
  email: string
  /** The deployment lets the account sign in with a password. */
  passwordAvailable: boolean
  hasPassword: boolean
  passwordChangedAt: Date | null
  /** The deployment lets the account sign in with a link or code mailed to it. */
  emailSignIn: boolean
  twoFactor: TwoFactorStatus
  /** `invite` mode: the account may invite others. */
  canInvite: boolean
}

/** What the security settings page needs that no list already gives. */
export class GetSecuritySummary {
  constructor(
    private users: UserRepository,
    private twoFactor: GetTwoFactorStatus,
    private policy: AuthPolicy,
  ) {}

  async execute(query: { userId: string }): Promise<SecuritySummary> {
    const user = await this.users.findById(query.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    return {
      email: user.email.value,
      passwordAvailable: this.policy.has('password'),
      hasPassword: user.hasPassword,
      passwordChangedAt: user.passwordChangedAt,
      emailSignIn: this.policy.has('email'),
      twoFactor: await this.twoFactor.execute(query),
      canInvite: this.policy.registration.mode === 'invite',
    }
  }
}
