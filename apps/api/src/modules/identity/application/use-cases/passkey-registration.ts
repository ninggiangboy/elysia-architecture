import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, NotFoundError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '#/shared/messaging'
import { WEBAUTHN_CHALLENGE_TTL_MS } from '../../domain/auth-challenge'
import { MAX_PASSKEYS_PER_USER, Passkey } from '../../domain/passkey'
import type {
  PasskeyRepository,
  UserRepository,
  WebAuthnChallengeRepository,
} from '../../domain/repositories'
import type { WebAuthnResponse, WebAuthnService } from '../ports'

export interface PasskeyView {
  id: string
  name: string
  deviceType: string
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}

export const toPasskeyView = (p: Passkey): PasskeyView => ({
  id: p.id,
  name: p.name,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
})

/** First half of adding a passkey: hands the browser the options (and a challenge to answer). Needs a recent confirmation. */
export class BeginPasskeyRegistration {
  constructor(
    private users: UserRepository,
    private passkeys: PasskeyRepository,
    private challenges: WebAuthnChallengeRepository,
    private webauthn: WebAuthnService,
    private stepUp: StepUpPolicy,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    authTime: number | undefined
  }): Promise<{ challengeId: string; options: unknown }> {
    this.stepUp.assertFresh(cmd.authTime)
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    const existing = await this.passkeys.listByUser(user.id)
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new ConflictError(
        'passkey_limit_reached',
        'You have reached the maximum number of passkeys',
      )
    }

    const { challenge, options } = await this.webauthn.registrationOptions({
      userId: user.id,
      userName: user.email.value,
      existing: existing.map((p) => ({ credentialId: p.credentialId, transports: p.transports })),
    })
    const now = this.clock.now()
    const challengeId = this.ids.next()
    await this.challenges.add({
      id: challengeId,
      challenge,
      purpose: 'register',
      userId: user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
    })
    return { challengeId, options }
  }
}

/** Second half: checks the browser's answer and stores the new passkey. */
export class FinishPasskeyRegistration {
  constructor(
    private passkeys: PasskeyRepository,
    private challenges: WebAuthnChallengeRepository,
    private webauthn: WebAuthnService,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    authTime: number | undefined
    challengeId: string
    response: WebAuthnResponse
    name?: string
  }): Promise<PasskeyView> {
    this.stepUp.assertFresh(cmd.authTime)
    const now = this.clock.now()
    const challenge = await this.challenges.consume(cmd.challengeId, 'register', now)
    if (!challenge || challenge.userId !== cmd.userId) {
      throw new ValidationError(
        'invalid_passkey_challenge',
        'This request expired, please try again',
      )
    }
    const credential = await this.webauthn.verifyRegistration({
      response: cmd.response,
      challenge: challenge.challenge,
    })
    if (!credential) {
      throw new ValidationError('passkey_verification_failed', 'Could not verify this passkey')
    }

    const passkey = Passkey.register({
      id: this.ids.next(),
      userId: cmd.userId,
      ...credential,
      name: Passkey.normalizeName(cmd.name),
      now,
    })
    await this.uow.run(async () => {
      await this.passkeys.add(passkey)
      await this.outbox.add(passkey.pullEvents())
    })
    return toPasskeyView(passkey)
  }
}
