import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { NotFoundError, TooManyRequestsError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { WEBAUTHN_CHALLENGE_TTL_MS } from '../../domain/auth-challenge'
import type {
  PasskeyRepository,
  StepUpCodeRepository,
  TotpCredentialRepository,
  UserRepository,
  WebAuthnChallengeRepository,
} from '../../domain/repositories'
import {
  STEP_UP_CODE_MAX_ATTEMPTS,
  STEP_UP_CODE_MAX_PER_WINDOW,
  STEP_UP_CODE_TTL_MS,
  STEP_UP_CODE_WINDOW_MS,
} from '../../domain/step-up-code'
import type { PasskeyAssertions } from '../passkey-assertions'
import type { PasswordHasher, TokenService, WebAuthnResponse, WebAuthnService } from '../ports'
import { stepUpCodeRequested } from '../security-events'
import type { SignInGuard } from '../sign-in-guard'
import { useTotpCode } from './two-factor'

export interface ElevatedToken {
  accessToken: string
  expiresIn: number
}

const CODE_DIGITS = 6

/** Same access token (same session), but stamped with "the user confirmed it is them just now". */
async function elevate(
  tokens: TokenService,
  clock: Clock,
  who: { userId: string; sessionId: string },
): Promise<ElevatedToken> {
  const access = await tokens.signAccessToken({ ...who, authTime: clock.now() })
  return { accessToken: access.token, expiresIn: access.expiresInSeconds }
}

/** Mails the user a one-time code that confirms a sensitive action. Replaces any earlier pending code. */
export class RequestStepUpCode {
  constructor(
    private users: UserRepository,
    private codes: StepUpCodeRepository,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string }): Promise<void> {
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    const now = this.clock.now()
    const since = new Date(now.getTime() - STEP_UP_CODE_WINDOW_MS)
    const issued = await this.codes.issuedSince(user.id, since)
    if (issued.count >= STEP_UP_CODE_MAX_PER_WINDOW) {
      // A new code is allowed once the oldest one counted leaves the window.
      const freesAt = (issued.oldest ?? now).getTime() + STEP_UP_CODE_WINDOW_MS
      throw new TooManyRequestsError(
        'step_up_rate_limited',
        'Too many codes requested, try later',
        Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)),
      )
    }

    const code = this.tokens.newNumericCode(CODE_DIGITS)
    const expiresAt = new Date(now.getTime() + STEP_UP_CODE_TTL_MS)
    await this.uow.run(async () => {
      await this.codes.issue({
        id: this.ids.next(),
        userId: user.id,
        codeHash: hashCode(this.tokens, user.id, code),
        createdAt: now,
        expiresAt,
      })
      await this.outbox.add([
        stepUpCodeRequested(
          { userId: user.id, email: user.email.value, code, expiresAt: expiresAt.toISOString() },
          now,
        ),
      ])
    })
  }
}

/** Keyed (a 6-digit code is brute-forced in a second from a plain hash) and bound to the user it was mailed to. */
const hashCode = (tokens: TokenService, userId: string, code: string) =>
  tokens.keyedHash(`${userId}:${code}`)

export class VerifyStepUpCode {
  constructor(
    private codes: StepUpCodeRepository,
    private tokens: TokenService,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; sessionId: string; code: string }): Promise<ElevatedToken> {
    const code = cmd.code.replace(/\s/g, '')
    const ok = await this.codes.verify(
      cmd.userId,
      hashCode(this.tokens, cmd.userId, code),
      this.clock.now(),
      STEP_UP_CODE_MAX_ATTEMPTS,
    )
    if (!ok) throw new ValidationError('invalid_step_up_code', 'This code is wrong or has expired')
    return elevate(this.tokens, this.clock, cmd)
  }
}

/** Step-up with a passkey, step 1: options restricted to the signed-in user's own passkeys. */
export class BeginStepUpPasskey {
  constructor(
    private passkeys: PasskeyRepository,
    private challenges: WebAuthnChallengeRepository,
    private webauthn: WebAuthnService,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string }): Promise<{ challengeId: string; options: unknown }> {
    const own = await this.passkeys.listByUser(cmd.userId)
    if (own.length === 0) throw new ValidationError('no_passkeys', 'You have no passkeys yet')
    const { challenge, options } = await this.webauthn.authenticationOptions({
      allow: own.map((p) => ({ credentialId: p.credentialId, transports: p.transports })),
    })
    const now = this.clock.now()
    const challengeId = this.ids.next()
    await this.challenges.add({
      id: challengeId,
      challenge,
      purpose: 'step_up',
      userId: cmd.userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
    })
    return { challengeId, options }
  }
}

export class FinishStepUpPasskey {
  constructor(
    private assertions: PasskeyAssertions,
    private tokens: TokenService,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    challengeId: string
    response: WebAuthnResponse
  }): Promise<ElevatedToken> {
    await this.assertions.verify({
      purpose: 'step_up',
      challengeId: cmd.challengeId,
      response: cmd.response,
      userId: cmd.userId,
    })
    return elevate(this.tokens, this.clock, cmd)
  }
}

/** Step-up with the authenticator app. Counts against the same guess limits as signing in. */
export class VerifyStepUpTotp {
  constructor(
    private users: UserRepository,
    private totp: TotpCredentialRepository,
    private guard: SignInGuard,
    private tokens: TokenService,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    code: string
    ip: string
  }): Promise<ElevatedToken> {
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    await this.guard.assertAllowed(user.email.value, cmd.ip)
    const credential = await this.totp.find(cmd.userId)
    const ok =
      credential?.confirmed &&
      (await useTotpCode(this.totp, credential, cmd.code, this.clock.now()))
    if (!ok) {
      await this.guard.recordFailure(user.email.value, cmd.ip, 'step_up_totp')
      throw new ValidationError('invalid_step_up_code', 'This code is wrong or has expired')
    }
    return elevate(this.tokens, this.clock, cmd)
  }
}

/** Step-up by typing the password again. */
export class VerifyStepUpPassword {
  constructor(
    private users: UserRepository,
    private hasher: PasswordHasher,
    private guard: SignInGuard,
    private tokens: TokenService,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    password: string
    ip: string
  }): Promise<ElevatedToken> {
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    await this.guard.assertAllowed(user.email.value, cmd.ip)
    const ok = await this.hasher.verify(cmd.password, user.passwordHash)
    if (!ok) {
      await this.guard.recordFailure(user.email.value, cmd.ip, 'step_up_password')
      throw new ValidationError('invalid_step_up_password', 'This password is wrong')
    }
    return elevate(this.tokens, this.clock, cmd)
  }
}
