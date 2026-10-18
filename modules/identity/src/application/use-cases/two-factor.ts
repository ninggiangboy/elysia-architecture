import { randomInt } from 'node:crypto'
import type { StepUpPolicy } from '@kit/auth'
import { newTotpSecret, totpUri, verifyTotp } from '@kit/auth'
import type { Clock, UnitOfWork } from '@kit/core'
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  VersionConflictError,
} from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type {
  MfaChallengeRepository,
  RecoveryCodeRepository,
  TotpCredentialRepository,
  UserRepository,
} from '../../domain/repositories'
import {
  looksLikeTotpCode,
  MFA_MAX_ATTEMPTS,
  newRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  TotpCredential,
} from '../../domain/two-factor'
import type { SessionResult } from '../auth-outcome'
import type { AuthPolicy } from '../auth-policy'
import type { TokenService } from '../ports'
import { twoFactorDisabled, twoFactorEnabled } from '../security-events'
import type { SessionMeta } from '../session-issuer'
import type { SessionStarter } from '../session-starter'
import type { SignInGuard } from '../sign-in-guard'

const unavailable = () =>
  new NotFoundError('two_factor_unavailable', 'Two-factor authentication is not available')

const recoveryHash = (tokens: TokenService, userId: string, code: string) =>
  tokens.keyedHash(`recovery:${userId}:${normalizeRecoveryCode(code)}`)

export interface TwoFactorStatus {
  /** The deployment offers authenticator apps. */
  available: boolean
  enabled: boolean
  recoveryCodesRemaining: number
}

export class GetTwoFactorStatus {
  constructor(
    private totp: TotpCredentialRepository,
    private recovery: RecoveryCodeRepository,
    private policy: AuthPolicy,
  ) {}

  async execute(query: { userId: string }): Promise<TwoFactorStatus> {
    if (!this.policy.twoFactor) {
      return { available: false, enabled: false, recoveryCodesRemaining: 0 }
    }
    const credential = await this.totp.find(query.userId)
    const enabled = credential?.confirmed ?? false
    return {
      available: true,
      enabled,
      recoveryCodesRemaining: enabled ? await this.recovery.remaining(query.userId) : 0,
    }
  }
}

/** Step 1: a fresh secret for the authenticator app. Nothing is on until a code from it is confirmed. */
export class BeginTwoFactorSetup {
  constructor(
    private users: UserRepository,
    private totp: TotpCredentialRepository,
    private policy: AuthPolicy,
    private stepUp: StepUpPolicy,
    private issuer: string,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    authTime: number | undefined
  }): Promise<{ secret: string; uri: string }> {
    if (!this.policy.twoFactor) throw unavailable()
    this.stepUp.assertFresh(cmd.authTime)
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    const secret = newTotpSecret()
    await this.totp.savePending(
      TotpCredential.pending({ userId: user.id, secret, now: this.clock.now() }),
    )
    return { secret, uri: totpUri({ secret, issuer: this.issuer, account: user.email.value }) }
  }
}

const newRecoveryCodes = () =>
  Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode(randomInt))

/** Step 2: the first correct code turns it on, and the recovery codes are shown — this once. */
export class EnableTwoFactor {
  constructor(
    private totp: TotpCredentialRepository,
    private recovery: RecoveryCodeRepository,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; code: string }): Promise<{ recoveryCodes: string[] }> {
    if (!this.policy.twoFactor) throw unavailable()
    const now = this.clock.now()
    return this.uow.run(async () => {
      const credential = await this.totp.find(cmd.userId)
      if (!credential) {
        throw new ValidationError('totp_not_started', 'Start the setup again to get a new secret')
      }
      if (credential.confirmed) throw new ConflictError('totp_already_enabled', 'Already on')
      const match = verifyTotp(credential.secret, cmd.code, now)
      if (!match)
        throw new ValidationError('invalid_totp_code', 'This code is wrong or has expired')
      credential.confirm(match.step, now)
      await this.totp.saveUse(credential)
      const recoveryCodes = newRecoveryCodes()
      await this.recovery.replace(
        cmd.userId,
        recoveryCodes.map((c) => recoveryHash(this.tokens, cmd.userId, c)),
        now,
      )
      await this.outbox.add([twoFactorEnabled({ userId: cmd.userId }, now)])
      return { recoveryCodes }
    })
  }
}

export class RegenerateRecoveryCodes {
  constructor(
    private totp: TotpCredentialRepository,
    private recovery: RecoveryCodeRepository,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private stepUp: StepUpPolicy,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    authTime: number | undefined
  }): Promise<{ recoveryCodes: string[] }> {
    if (!this.policy.twoFactor) throw unavailable()
    this.stepUp.assertFresh(cmd.authTime)
    return this.uow.run(async () => {
      if (!(await this.totp.find(cmd.userId))?.confirmed) {
        throw new NotFoundError('two_factor_not_enabled', 'Two-factor authentication is not on')
      }
      const recoveryCodes = newRecoveryCodes()
      await this.recovery.replace(
        cmd.userId,
        recoveryCodes.map((c) => recoveryHash(this.tokens, cmd.userId, c)),
        this.clock.now(),
      )
      return { recoveryCodes }
    })
  }
}

export class DisableTwoFactor {
  constructor(
    private totp: TotpCredentialRepository,
    private recovery: RecoveryCodeRepository,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; authTime: number | undefined }): Promise<void> {
    this.stepUp.assertFresh(cmd.authTime)
    await this.uow.run(async () => {
      const credential = await this.totp.find(cmd.userId)
      if (!credential?.confirmed) {
        // A pending enrolment is simply dropped.
        await this.totp.remove(cmd.userId)
        if (!credential) {
          throw new NotFoundError('two_factor_not_enabled', 'Two-factor authentication is not on')
        }
        return
      }
      await this.totp.remove(cmd.userId)
      await this.recovery.removeAll(cmd.userId)
      await this.outbox.add([twoFactorDisabled({ userId: cmd.userId }, this.clock.now())])
    })
  }
}

/** Accepts a current code once; false when it is wrong or was already used. */
export async function useTotpCode(
  totp: TotpCredentialRepository,
  credential: TotpCredential,
  code: string,
  now: Date,
): Promise<boolean> {
  const match = verifyTotp(credential.secret, code, now)
  if (!match) return false
  try {
    credential.recordUse(match.step)
    await totp.saveUse(credential)
    return true
  } catch (err) {
    // Replayed in the same step, or two requests racing with the same code: only one gets through.
    if (err instanceof UnauthorizedError || err instanceof VersionConflictError) return false
    throw err
  }
}

/** The second step of a sign-in: the authenticator code (or a recovery code) answers the challenge the first step issued. */
export class VerifyMfaLogin {
  constructor(
    private challenges: MfaChallengeRepository,
    private totp: TotpCredentialRepository,
    private recovery: RecoveryCodeRepository,
    private users: UserRepository,
    private starter: SessionStarter,
    private guard: SignInGuard,
    private tokens: TokenService,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    mfaToken: string
    code: string
    meta: SessionMeta
  }): Promise<SessionResult> {
    const now = this.clock.now()
    const challenge = await this.challenges.findLive(
      this.tokens.hashOpaqueToken(cmd.mfaToken),
      now,
      MFA_MAX_ATTEMPTS,
    )
    if (!challenge) throw expired()
    const user = await this.users.findById(challenge.userId)
    if (!user) throw expired()
    const ip = cmd.meta.ip ?? 'unknown'
    await this.guard.assertAllowed(user.email.value, ip)

    const outcome = await this.uow.run(async () => {
      const factor = await this.checkSecondFactor(user.id, cmd.code, now)
      if (!factor) return null
      if (!(await this.challenges.consume(challenge.id, now))) throw expired()
      const session = await this.starter.start({
        userId: user.id,
        meta: cmd.meta,
        method: challenge.method,
        secondFactor: factor,
      })
      return { user: { id: user.id, email: user.email.value }, session }
    })
    if (!outcome) {
      // Outside the transaction so the counts survive: five wrong codes close this challenge.
      await this.challenges.recordFailure(challenge.id)
      await this.guard.recordFailure(user.email.value, ip, 'mfa')
      throw new UnauthorizedError('invalid_mfa_code', 'This code is wrong or has expired')
    }
    return outcome
  }

  private async checkSecondFactor(
    userId: string,
    code: string,
    now: Date,
  ): Promise<'totp' | 'recovery_code' | null> {
    if (looksLikeTotpCode(code)) {
      const credential = await this.totp.find(userId)
      if (!credential?.confirmed) return null
      return (await useTotpCode(this.totp, credential, code, now)) ? 'totp' : null
    }
    return (await this.recovery.consume(userId, recoveryHash(this.tokens, userId, code), now))
      ? 'recovery_code'
      : null
  }
}

const expired = () =>
  new UnauthorizedError('mfa_challenge_expired', 'Sign in again to get a new code prompt')
