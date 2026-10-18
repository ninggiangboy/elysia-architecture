import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { OAUTH_STATE_TTL_MS, type OAuthPurpose } from '../../domain/auth-challenge'
import { Email } from '../../domain/email'
import { OAuthAccount, type OAuthProviderId } from '../../domain/oauth-account'
import type {
  OAuthAccountRepository,
  OAuthStateRepository,
  UserRepository,
} from '../../domain/repositories'
import type { User } from '../../domain/user'
import type { AccountRegistrar } from '../account-registrar'
import type { AuthOutcome } from '../auth-outcome'
import type { OAuthGateway, OAuthProfile, TokenService } from '../ports'
import { oauthAccountUnlinked } from '../security-events'
import type { SessionMeta } from '../session-issuer'
import type { SignInCompleter } from '../sign-in-completer'
import type { SignInMethodGuard } from '../sign-in-method-guard'

const unavailable = () =>
  new NotFoundError('oauth_provider_unavailable', 'This sign-in method is not available')

export class ListOAuthProviders {
  constructor(private gateway: OAuthGateway) {}

  execute(): { providers: OAuthProviderId[]; names: Record<string, string> } {
    return {
      providers: this.gateway.enabledProviders(),
      names: this.gateway.providerNames?.() ?? {},
    }
  }
}

/**
 * Starts an authorization-code + PKCE flow and returns where to send the browser. Signing in needs nothing; linking an
 * account to a signed-in user needs a recent confirmation, and the state remembers who started it.
 */
export class BeginOAuth {
  constructor(
    private gateway: OAuthGateway,
    private states: OAuthStateRepository,
    private tokens: TokenService,
    private stepUp: StepUpPolicy,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    provider: string
    purpose: OAuthPurpose
    userId?: string
    authTime?: number
  }): Promise<{ url: string }> {
    if (!this.gateway.enabledProviders().includes(cmd.provider)) throw unavailable()
    if (cmd.purpose === 'link') this.stepUp.assertFresh(cmd.authTime)

    const state = this.tokens.newOpaqueToken()
    const codeVerifier = this.tokens.newOpaqueToken().token
    const now = this.clock.now()
    await this.states.add({
      id: this.ids.next(),
      stateHash: state.hash,
      provider: cmd.provider,
      codeVerifier,
      purpose: cmd.purpose,
      userId: cmd.purpose === 'link' ? (cmd.userId ?? null) : null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    })
    return {
      url: await this.gateway.authorizationUrl(cmd.provider, { state: state.token, codeVerifier }),
    }
  }
}

export type CompleteOAuthResult =
  | { kind: 'login'; outcome: AuthOutcome }
  | { kind: 'link'; provider: OAuthProviderId; email: string | null }

/**
 * The provider sent the browser back with a `code`. Which flow it belongs to is read from the stored state, never from the
 * request, so a code cannot be replayed into a different flow.
 */
export class CompleteOAuth {
  constructor(
    private gateway: OAuthGateway,
    private states: OAuthStateRepository,
    private accounts: OAuthAccountRepository,
    private users: UserRepository,
    private completer: SignInCompleter,
    private registrar: AccountRegistrar,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    state: string
    code: string
    meta: SessionMeta
    /** Language of the browser, for an account this sign-in creates. */
    locale?: Locale
    /** The user making the request, if it carried an access token. */
    authUserId?: string
  }): Promise<CompleteOAuthResult> {
    const now = this.clock.now()
    const state = await this.states.consume(this.tokens.hashOpaqueToken(cmd.state), now)
    if (!state) {
      throw new ValidationError(
        'invalid_oauth_state',
        'This sign-in attempt expired, please try again',
      )
    }
    // Linking must be finished by the user who started it — otherwise a victim could be tricked into attaching
    // their own Google/GitHub identity to an account the attacker controls.
    if (state.purpose === 'link' && (!state.userId || state.userId !== cmd.authUserId)) {
      throw new ForbiddenError('oauth_state_mismatch', 'Sign in to the account you are connecting')
    }

    const provider: OAuthProviderId = state.provider
    const profile = await this.gateway.exchange(provider, {
      code: cmd.code,
      codeVerifier: state.codeVerifier,
    })
    if (!profile)
      throw new ValidationError('oauth_exchange_failed', 'The provider rejected this sign-in')

    if (state.purpose === 'link' && state.userId) return this.link(state.userId, provider, profile)
    return this.login(provider, profile, cmd.meta, cmd.locale ?? DEFAULT_LOCALE)
  }

  private async link(
    userId: string,
    provider: OAuthProviderId,
    profile: OAuthProfile,
  ): Promise<CompleteOAuthResult> {
    const now = this.clock.now()
    return this.uow.run(async () => {
      const existing = await this.accounts.findByProviderUser(provider, profile.providerUserId)
      if (existing && existing.userId !== userId) {
        throw new ConflictError(
          'oauth_account_taken',
          'That account is already connected to another user',
        )
      }
      if (!existing) {
        const mine = await this.accounts.listByUser(userId)
        if (mine.some((a) => a.provider === provider)) {
          throw new ConflictError(
            'oauth_provider_already_linked',
            'You already connected a different account',
          )
        }
        const account = OAuthAccount.link({
          id: this.ids.next(),
          userId,
          provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          now,
        })
        await this.accounts.add(account)
        await this.outbox.add(account.pullEvents())
      }
      return { kind: 'link', provider, email: profile.email } as const
    })
  }

  private async login(
    provider: OAuthProviderId,
    profile: OAuthProfile,
    meta: SessionMeta,
    locale: Locale,
  ): Promise<CompleteOAuthResult> {
    try {
      return await this.attemptLogin(provider, profile, meta, locale)
    } catch (err) {
      // Two first-time sign-ins racing on the same new account: the loser hit a unique constraint and rolled back,
      // so a retry finds what the winner created.
      if (err instanceof ConflictError) return this.attemptLogin(provider, profile, meta, locale)
      throw err
    }
  }

  private attemptLogin(
    provider: OAuthProviderId,
    profile: OAuthProfile,
    meta: SessionMeta,
    locale: Locale,
  ): Promise<CompleteOAuthResult> {
    return this.uow.run(async (): Promise<CompleteOAuthResult> => {
      const method = `oauth:${provider}`
      const user = await this.knownUser(provider, profile)
      if (user) {
        return { kind: 'login', outcome: await this.completer.complete({ user, method, meta }) }
      }
      // An identity nobody has used here, with no account for its address: this is a sign-up.
      const email = this.verifiedEmail(profile)
      const outcome = await this.registrar.onProvenEmail({
        email,
        method,
        locale,
        meta,
        displayName: profile.displayName,
        oauth: { provider, providerUserId: profile.providerUserId, email: profile.email },
      })
      return { kind: 'login', outcome }
    })
  }

  /**
   * The user this provider identity belongs to — found by the link, else matched by email and linked; null when
   * there is none. Matching an existing account by email is safe only because the provider vouches the user controls
   * that address (the same proof a magic link gives).
   */
  private async knownUser(provider: OAuthProviderId, profile: OAuthProfile): Promise<User | null> {
    const linked = await this.accounts.findByProviderUser(provider, profile.providerUserId)
    if (linked) {
      const user = await this.users.findById(linked.userId)
      if (!user) throw new NotFoundError('user_not_found', 'User not found')
      return user
    }
    const email = this.verifiedEmail(profile)
    const user = await this.users.findByEmail(email)
    if (!user) return null
    const account = OAuthAccount.link({
      id: this.ids.next(),
      userId: user.id,
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      now: this.clock.now(),
    })
    await this.accounts.add(account)
    await this.outbox.add(account.pullEvents())
    return user
  }

  private verifiedEmail(profile: OAuthProfile): Email {
    if (!profile.email || !profile.emailVerified) {
      throw new ValidationError(
        'oauth_email_unverified',
        'The provider has no verified email for this account',
      )
    }
    return Email.create(profile.email)
  }
}

export interface OAuthAccountView {
  provider: OAuthProviderId
  email: string | null
  linkedAt: Date
}

export class ListOAuthAccounts {
  constructor(private accounts: OAuthAccountRepository) {}

  async execute(query: { userId: string }): Promise<OAuthAccountView[]> {
    return (await this.accounts.listByUser(query.userId)).map((a) => ({
      provider: a.provider,
      email: a.email,
      linkedAt: a.createdAt,
    }))
  }
}

/** What is left must still let the user in (email sign-in, a password, a passkey or another provider). */
export class UnlinkOAuthAccount {
  constructor(
    private accounts: OAuthAccountRepository,
    private methods: SignInMethodGuard,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    provider: string
    authTime: number | undefined
  }): Promise<void> {
    this.stepUp.assertFresh(cmd.authTime)
    const provider = cmd.provider
    await this.uow.run(async () => {
      await this.methods.assertKeepsOne(cmd.userId, 'oauth')
      if (!(await this.accounts.remove(cmd.userId, provider))) {
        throw new NotFoundError('oauth_account_not_found', 'Account not found')
      }
      await this.outbox.add([
        oauthAccountUnlinked({ userId: cmd.userId, provider }, this.clock.now()),
      ])
    })
  }
}
