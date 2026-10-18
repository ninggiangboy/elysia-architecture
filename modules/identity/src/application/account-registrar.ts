import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { Clock, IdGenerator } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { Email } from '../domain/email'
import { OAuthAccount } from '../domain/oauth-account'
import type {
  InvitationRepository,
  OAuthAccountRepository,
  SignupRepository,
  UserRepository,
} from '../domain/repositories'
import { normalizeDisplayName, SIGNUP_TTL_MS } from '../domain/signup'
import { User } from '../domain/user'
import type { AuthOutcome } from './auth-outcome'
import type { AuthPolicy } from './auth-policy'
import type { TokenService } from './ports'
import type { SessionMeta } from './session-issuer'
import type { SessionStarter } from './session-starter'

export interface ProvenEmail {
  email: Email
  /** How it was proven: `magic_link`, `email_code`, `password`, `oauth:<provider>`. */
  method: string
  locale?: Locale
  meta: SessionMeta
  displayName?: string | null
  /** The provider identity to link to the new account. */
  oauth?: { provider: string; providerUserId: string; email: string | null }
}

/**
 * The one place accounts are created. Every way of signing up arrives here with an email the person has proven, so the
 * registration rules (mode, domain, invitation, terms) and the side effects (invitation accepted, provider linked,
 * events) cannot differ between methods. Call inside the UnitOfWork.
 */
export class AccountRegistrar {
  constructor(
    private users: UserRepository,
    private oauthAccounts: OAuthAccountRepository,
    private invitations: InvitationRepository,
    private signups: SignupRepository,
    private starter: SessionStarter,
    private policy: AuthPolicy,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  /** Throws unless the terms (when the deployment has any) were accepted; checked before a token is spent on it. */
  assertTermsAccepted(accepted: boolean | undefined): void {
    this.policy.registration.acceptedTerms(accepted)
  }

  /** Throws when `email` may not get an account. */
  async assertMayRegister(email: Email): Promise<void> {
    const invited = await this.invitations.hasPending(email, this.clock.now())
    this.policy.registration.assertMayRegister(email, invited)
  }

  /** An email nobody has an account for was just proven: create the account, or park a sign-up form if terms are due. */
  async onProvenEmail(proven: ProvenEmail): Promise<AuthOutcome> {
    await this.assertMayRegister(proven.email)
    const now = this.clock.now()
    const terms = this.policy.registration.termsVersion
    if (terms) {
      const { token, hash } = this.tokens.newOpaqueToken()
      await this.signups.add({
        id: this.ids.next(),
        email: proven.email.value,
        tokenHash: hash,
        codeHash: null,
        emailProvenAt: now,
        method: proven.method,
        passwordHash: null,
        displayName: normalizeDisplayName(proven.displayName),
        termsVersion: null,
        locale: proven.locale ?? DEFAULT_LOCALE,
        oauth: proven.oauth ?? null,
        requestedIp: proven.meta.ip,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SIGNUP_TTL_MS),
      })
      return {
        kind: 'signup_required',
        signupToken: token,
        email: proven.email.value,
        suggestedName: normalizeDisplayName(proven.displayName),
        termsVersion: terms,
      }
    }
    return this.createAndSignIn({ ...proven, termsAccepted: false })
  }

  /** Creates the account and its first session. */
  async createAndSignIn(
    params: ProvenEmail & { passwordHash?: string | null; termsAccepted?: boolean },
  ): Promise<AuthOutcome> {
    const user = await this.create(params)
    const session = await this.starter.start({
      userId: user.id,
      meta: params.meta,
      method: params.method,
      newUser: true,
    })
    return {
      kind: 'session',
      user: { id: user.id, email: user.email.value },
      session,
      newUser: true,
    }
  }

  async create(
    params: ProvenEmail & { passwordHash?: string | null; termsAccepted?: boolean },
  ): Promise<User> {
    const now = this.clock.now()
    const user = User.register({
      id: this.ids.next(),
      email: params.email,
      locale: params.locale ?? DEFAULT_LOCALE,
      now,
      method: params.method,
      displayName: normalizeDisplayName(params.displayName),
      passwordHash: params.passwordHash,
      termsVersion: this.policy.registration.acceptedTerms(params.termsAccepted),
    })
    await this.users.save(user)
    await this.outbox.add(user.pullEvents())
    if (params.oauth) {
      // A brand-new account does not need to be told about the one method it was created with.
      await this.oauthAccounts.add(
        OAuthAccount.link({
          id: this.ids.next(),
          userId: user.id,
          provider: params.oauth.provider,
          providerUserId: params.oauth.providerUserId,
          email: params.oauth.email,
          now,
        }),
      )
    }
    await this.invitations.accept(params.email, now)
    return user
  }
}
