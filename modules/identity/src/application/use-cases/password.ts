import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { NotFoundError, UnauthorizedError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import {
  assertAcceptablePassword,
  PASSWORD_RESET_MAX_PER_EMAIL,
  PASSWORD_RESET_MAX_PER_IP,
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_WINDOW_MS,
} from '../../domain/password'
import type { PasswordResetRepository, UserRepository } from '../../domain/repositories'
import type { AuthOutcome } from '../auth-outcome'
import type { AuthPolicy } from '../auth-policy'
import type { PasswordHasher, TokenService } from '../ports'
import { passwordResetRequested } from '../security-events'
import type { SessionMeta } from '../session-issuer'
import type { SessionRevocation } from '../session-revocation'
import type { SignInCompleter } from '../sign-in-completer'
import type { SignInGuard } from '../sign-in-guard'
import type { SignInMethodGuard } from '../sign-in-method-guard'
import { assertUnderLimit } from '../throttle'

const unavailable = () =>
  new NotFoundError('sign_in_method_unavailable', 'This sign-in method is not available')

/** One message for "no such account", "no password" and "wrong password", so the answer does not reveal which. */
const invalidCredentials = () =>
  new UnauthorizedError('invalid_credentials', 'Email or password is incorrect')

export class LoginWithPassword {
  constructor(
    private users: UserRepository,
    private hasher: PasswordHasher,
    private guard: SignInGuard,
    private completer: SignInCompleter,
    private policy: AuthPolicy,
    private uow: UnitOfWork,
  ) {}

  async execute(cmd: { email: string; password: string; meta: SessionMeta }): Promise<AuthOutcome> {
    if (!this.policy.has('password')) throw unavailable()
    // An address that is not valid cannot be registered: same answer as a wrong password.
    let email: Email
    try {
      email = Email.create(cmd.email)
    } catch {
      await this.hasher.verify(cmd.password, null)
      throw invalidCredentials()
    }
    const ip = cmd.meta.ip ?? 'unknown'
    await this.guard.assertAllowed(email.value, ip)

    const user = await this.users.findByEmail(email)
    const ok = await this.hasher.verify(cmd.password, user?.passwordHash ?? null)
    if (!user || !ok) {
      await this.guard.recordFailure(email.value, ip, 'password')
      throw invalidCredentials()
    }
    return this.uow.run(() => this.completer.complete({ user, method: 'password', meta: cmd.meta }))
  }
}

/**
 * "I forgot my password" — also how someone who signed up without one sets it. The answer is the same whether or not
 * the address has an account; only the owner gets a mail.
 */
export class RequestPasswordReset {
  constructor(
    private users: UserRepository,
    private resets: PasswordResetRepository,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { email: string; ip: string }): Promise<void> {
    if (!this.policy.has('password')) throw unavailable()
    const email = Email.create(cmd.email)
    const now = this.clock.now()
    const since = new Date(now.getTime() - PASSWORD_RESET_WINDOW_MS)
    assertUnderLimit({
      seen: await this.resets.requestedSince({ email: email.value }, since),
      max: PASSWORD_RESET_MAX_PER_EMAIL,
      windowMs: PASSWORD_RESET_WINDOW_MS,
      now,
      code: 'password_reset_rate_limited',
    })
    assertUnderLimit({
      seen: await this.resets.requestedSince({ ip: cmd.ip }, since),
      max: PASSWORD_RESET_MAX_PER_IP,
      windowMs: PASSWORD_RESET_WINDOW_MS,
      now,
      code: 'password_reset_rate_limited',
    })

    const user = await this.users.findByEmail(email)
    if (!user) return
    const { token, hash } = this.tokens.newOpaqueToken()
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS)
    await this.uow.run(async () => {
      await this.resets.issue({
        id: this.ids.next(),
        userId: user.id,
        email: email.value,
        tokenHash: hash,
        requestedIp: cmd.ip,
        createdAt: now,
        expiresAt,
      })
      await this.outbox.add([
        passwordResetRequested(
          { userId: user.id, email: email.value, token, expiresAt: expiresAt.toISOString() },
          now,
        ),
      ])
    })
  }
}

/** The mailed token proves the mailbox; every session is ended, since whoever knew the old password may be in one. */
export class ResetPassword {
  constructor(
    private users: UserRepository,
    private resets: PasswordResetRepository,
    private hasher: PasswordHasher,
    private tokens: TokenService,
    private revocation: SessionRevocation,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { token: string; newPassword: string }): Promise<void> {
    if (!this.policy.has('password')) throw unavailable()
    assertAcceptablePassword(cmd.newPassword, this.policy.passwordMinLength)
    const hash = await this.hasher.hash(cmd.newPassword)
    const now = this.clock.now()
    await this.uow.run(async () => {
      const reset = await this.resets.consume(this.tokens.hashOpaqueToken(cmd.token), now)
      const user = reset && (await this.users.findById(reset.userId))
      if (!reset || !user) {
        throw new ValidationError('invalid_password_reset', 'This link is invalid or has expired')
      }
      user.setPassword(hash, now, true)
      await this.users.save(user)
      await this.outbox.add(user.pullEvents())
      await this.revocation.afterPasswordChange(user.id)
    })
  }
}

/** Sets a first password or replaces the current one. Needs a recent confirmation; other devices are signed out. */
export class SetPassword {
  constructor(
    private users: UserRepository,
    private hasher: PasswordHasher,
    private revocation: SessionRevocation,
    private policy: AuthPolicy,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    newPassword: string
    authTime: number | undefined
  }): Promise<{ change: 'set' | 'changed' }> {
    if (!this.policy.has('password')) throw unavailable()
    this.stepUp.assertFresh(cmd.authTime)
    assertAcceptablePassword(cmd.newPassword, this.policy.passwordMinLength)
    const hash = await this.hasher.hash(cmd.newPassword)
    const now = this.clock.now()
    return this.uow.run(async () => {
      const user = await this.users.findById(cmd.userId)
      if (!user) throw new NotFoundError('user_not_found', 'User not found')
      const change = user.setPassword(hash, now) as 'set' | 'changed'
      await this.users.save(user)
      await this.outbox.add(user.pullEvents())
      await this.revocation.afterPasswordChange(user.id, cmd.sessionId)
      return { change }
    })
  }
}

export class RemovePassword {
  constructor(
    private users: UserRepository,
    private methods: SignInMethodGuard,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; authTime: number | undefined }): Promise<void> {
    this.stepUp.assertFresh(cmd.authTime)
    await this.uow.run(async () => {
      const user = await this.users.findById(cmd.userId)
      if (!user) throw new NotFoundError('user_not_found', 'User not found')
      user.removePassword(this.clock.now())
      await this.methods.assertKeepsOne(user.id, 'password')
      await this.users.save(user)
      await this.outbox.add(user.pullEvents())
    })
  }
}
