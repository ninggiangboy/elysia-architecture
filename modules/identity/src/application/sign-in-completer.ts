import type { Clock, IdGenerator } from '@kit/core'
import type { MfaChallengeRepository, TotpCredentialRepository } from '../domain/repositories'
import { MFA_CHALLENGE_TTL_MS, type MfaChallenge } from '../domain/two-factor'
import type { User } from '../domain/user'
import type { AuthOutcome } from './auth-outcome'
import type { AuthPolicy } from './auth-policy'
import type { TokenService } from './ports'
import type { SessionMeta } from './session-issuer'
import type { SessionStarter } from './session-starter'

/**
 * A passkey is two factors in one (possession + user verification) and a provider has its own second step, so only the
 * methods that rest on a single secret (a password, something mailed) are followed by the authenticator code.
 */
const NEEDS_SECOND_FACTOR = new Set(['password', 'magic_link', 'email_code'])

/**
 * The end of every first-factor sign-in for an existing account: start the session, or — when the account has an
 * authenticator and the method is a single-secret one — hand out a short-lived challenge to finish with `/auth/mfa/verify`.
 * Call inside the UnitOfWork.
 */
export class SignInCompleter {
  constructor(
    private starter: SessionStarter,
    private totp: TotpCredentialRepository,
    private challenges: MfaChallengeRepository,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async complete(params: { user: User; method: string; meta: SessionMeta }): Promise<AuthOutcome> {
    const { user, method, meta } = params
    if (this.policy.twoFactor && NEEDS_SECOND_FACTOR.has(method)) {
      const credential = await this.totp.find(user.id)
      if (credential?.confirmed) return this.challenge(user.id, method)
    }
    const session = await this.starter.start({ userId: user.id, meta, method })
    return {
      kind: 'session',
      user: { id: user.id, email: user.email.value },
      session,
      newUser: false,
    }
  }

  private async challenge(userId: string, method: string): Promise<AuthOutcome> {
    const now = this.clock.now()
    const { token, hash } = this.tokens.newOpaqueToken()
    const challenge: MfaChallenge = {
      id: this.ids.next(),
      tokenHash: hash,
      userId,
      method,
      createdAt: now,
      expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
    }
    await this.challenges.add(challenge)
    return { kind: 'mfa_required', mfaToken: token, expiresAt: challenge.expiresAt }
  }
}
