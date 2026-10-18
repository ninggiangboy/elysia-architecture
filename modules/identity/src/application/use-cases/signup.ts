import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ForbiddenError, NotFoundError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import { assertAcceptablePassword } from '../../domain/password'
import type { SignupRepository, UserRepository } from '../../domain/repositories'
import {
  normalizeDisplayName,
  SIGNUP_CODE_MAX_ATTEMPTS,
  SIGNUP_MAX_PER_EMAIL,
  SIGNUP_MAX_PER_IP,
  SIGNUP_VERIFICATION_TTL_MS,
  SIGNUP_WINDOW_MS,
  type Signup,
} from '../../domain/signup'
import type { AccountRegistrar } from '../account-registrar'
import type { AuthOutcome, SessionOutcome } from '../auth-outcome'
import type { AuthPolicy } from '../auth-policy'
import type { PasswordHasher, TokenService } from '../ports'
import { signupExistingAccount, signupVerificationRequested } from '../security-events'
import type { SessionMeta } from '../session-issuer'
import type { SignInGuard } from '../sign-in-guard'
import { assertUnderLimit } from '../throttle'

const signupCodeHash = (tokens: TokenService, email: string, code: string) =>
  tokens.keyedHash(`signup-code:${email}:${code}`)

/**
 * Sign-up with a password. The account is not created here: a pending sign-up is mailed a link and a code, and only
 * proving the mailbox creates the user. The answer (202) is the same for an address that already has an account —
 * whose owner gets a notice instead — and for one the registration rules refuse, so the form is not an oracle for
 * "who is a member".
 */
export class RegisterWithPassword {
  constructor(
    private users: UserRepository,
    private signups: SignupRepository,
    private registrar: AccountRegistrar,
    private hasher: PasswordHasher,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    email: string
    password: string
    displayName?: string
    acceptTerms?: boolean
    ip: string
    locale?: Locale
  }): Promise<void> {
    if (!this.policy.has('password')) {
      throw new NotFoundError('sign_in_method_unavailable', 'This sign-in method is not available')
    }
    const email = Email.create(cmd.email)
    assertAcceptablePassword(cmd.password, this.policy.passwordMinLength)
    const termsVersion = this.policy.registration.acceptedTerms(cmd.acceptTerms)
    // Hash before looking the address up: an existing and a new address cost the same.
    const passwordHash = await this.hasher.hash(cmd.password)

    const now = this.clock.now()
    const since = new Date(now.getTime() - SIGNUP_WINDOW_MS)
    assertUnderLimit({
      seen: await this.signups.startedSince({ email: email.value }, since),
      max: SIGNUP_MAX_PER_EMAIL,
      windowMs: SIGNUP_WINDOW_MS,
      now,
      code: 'signup_rate_limited',
    })
    assertUnderLimit({
      seen: await this.signups.startedSince({ ip: cmd.ip }, since),
      max: SIGNUP_MAX_PER_IP,
      windowMs: SIGNUP_WINDOW_MS,
      now,
      code: 'signup_rate_limited',
    })

    const existing = await this.users.findByEmail(email)
    const allowed = existing ? true : await this.mayRegister(email)
    const real = !existing && allowed
    const { token, hash } = this.tokens.newOpaqueToken()
    const code = this.tokens.newNumericCode(6)
    const expiresAt = new Date(now.getTime() + SIGNUP_VERIFICATION_TTL_MS)
    await this.uow.run(async () => {
      // Every request leaves a row, so the throttle above counts them all; only a real one is mailed a token that opens it.
      await this.signups.add({
        id: this.ids.next(),
        email: email.value,
        tokenHash: hash,
        codeHash: signupCodeHash(this.tokens, email.value, code),
        emailProvenAt: null,
        method: 'password',
        passwordHash: real ? passwordHash : null,
        displayName: normalizeDisplayName(cmd.displayName),
        termsVersion,
        locale: cmd.locale ?? DEFAULT_LOCALE,
        oauth: null,
        requestedIp: cmd.ip,
        createdAt: now,
        expiresAt,
      })
      if (existing) {
        await this.outbox.add([
          signupExistingAccount({ userId: existing.id, email: email.value }, now),
        ])
      } else if (real) {
        await this.outbox.add([
          signupVerificationRequested(
            {
              email: email.value,
              locale: cmd.locale ?? DEFAULT_LOCALE,
              token,
              code,
              expiresAt: expiresAt.toISOString(),
            },
            now,
          ),
        ])
      }
    })
  }

  private async mayRegister(email: Email): Promise<boolean> {
    try {
      await this.registrar.assertMayRegister(email)
      return true
    } catch (err) {
      if (err instanceof ForbiddenError) return false
      throw err
    }
  }
}

const invalidVerification = () =>
  new ValidationError('invalid_signup_verification', 'This link or code is invalid or has expired')

/** The mailbox is proven (link or code): the account is created with the password chosen at sign-up, and signed in. */
export class VerifySignup {
  constructor(
    private signups: SignupRepository,
    private registrar: AccountRegistrar,
    private guard: SignInGuard,
    private tokens: TokenService,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  verifyToken(cmd: { token: string; meta: SessionMeta }): Promise<SessionOutcome> {
    const hash = this.tokens.hashOpaqueToken(cmd.token)
    return this.run(cmd.meta, (now) => this.signups.consume(hash, now))
  }

  async verifyCode(cmd: {
    email: string
    code: string
    meta: SessionMeta
  }): Promise<SessionOutcome> {
    const email = Email.create(cmd.email)
    const ip = cmd.meta.ip ?? 'unknown'
    await this.guard.assertAllowed(email.value, ip)
    try {
      return await this.run(cmd.meta, (now) =>
        this.signups.consumeByCode(
          email,
          signupCodeHash(this.tokens, email.value, cmd.code.replace(/\s/g, '')),
          now,
          SIGNUP_CODE_MAX_ATTEMPTS,
        ),
      )
    } catch (err) {
      if (err instanceof ValidationError)
        await this.guard.recordFailure(email.value, ip, 'signup_code')
      throw err
    }
  }

  private async run(
    meta: SessionMeta,
    consume: (now: Date) => Promise<Signup | null>,
  ): Promise<SessionOutcome> {
    const now = this.clock.now()
    const outcome = await this.uow.run(async (): Promise<AuthOutcome | null> => {
      const signup = await consume(now)
      // Not found commits (a wrong code's attempt count must stay); a row of the wrong kind rolls back and stays usable.
      if (!signup) return null
      // A decoy row (the address already had an account) has no password and can never be opened.
      if (signup.emailProvenAt || !signup.passwordHash) throw invalidVerification()
      const email = Email.create(signup.email)
      await this.registrar.assertMayRegister(email)
      return this.registrar.createAndSignIn({
        email,
        method: 'password',
        locale: signup.locale as Locale,
        meta,
        displayName: signup.displayName,
        passwordHash: signup.passwordHash,
        termsAccepted: signup.termsVersion !== null,
      })
    })
    if (outcome?.kind !== 'session') throw invalidVerification()
    return outcome
  }
}

const invalidSignup = () =>
  new ValidationError('invalid_signup', 'This sign-up expired, please start again')

/** Second half of a passwordless sign-up when terms must be accepted: the form after the email was proven. */
export class CompleteSignup {
  constructor(
    private signups: SignupRepository,
    private registrar: AccountRegistrar,
    private tokens: TokenService,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    signupToken: string
    displayName?: string
    acceptTerms?: boolean
    meta: SessionMeta
  }): Promise<SessionOutcome> {
    // Before the token is spent, so a forgotten tick leaves the form usable.
    this.registrar.assertTermsAccepted(cmd.acceptTerms)
    const now = this.clock.now()
    const outcome = await this.uow.run(async (): Promise<AuthOutcome | null> => {
      const signup = await this.signups.consume(this.tokens.hashOpaqueToken(cmd.signupToken), now)
      if (!signup) return null
      if (!signup.emailProvenAt) throw invalidSignup()
      const email = Email.create(signup.email)
      await this.registrar.assertMayRegister(email)
      return this.registrar.createAndSignIn({
        email,
        method: signup.method,
        locale: signup.locale as Locale,
        meta: cmd.meta,
        displayName: cmd.displayName ?? signup.displayName,
        oauth: signup.oauth ?? undefined,
        termsAccepted: cmd.acceptTerms,
      })
    })
    if (outcome?.kind !== 'session') throw invalidSignup()
    return outcome
  }
}
