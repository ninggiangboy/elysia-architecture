import { UnauthorizedError } from '#/shared/application/errors'
import type { Clock, IdGenerator, UnitOfWork } from '#/shared/application/ports'
import { WEBAUTHN_CHALLENGE_TTL_MS } from '../../domain/auth-challenge'
import type { UserRepository, WebAuthnChallengeRepository } from '../../domain/repositories'
import type { PasskeyAssertions } from '../passkey-assertions'
import type { WebAuthnResponse, WebAuthnService } from '../ports'
import type { SessionMeta } from '../session-issuer'
import type { SessionStarter } from '../session-starter'
import type { VerifyMagicLinkResult } from './verify-magic-link'

/** Usernameless sign-in, step 1: options that let the browser offer any passkey it holds for this site. */
export class BeginPasskeyLogin {
  constructor(
    private challenges: WebAuthnChallengeRepository,
    private webauthn: WebAuthnService,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(): Promise<{ challengeId: string; options: unknown }> {
    const { challenge, options } = await this.webauthn.authenticationOptions({})
    const now = this.clock.now()
    const challengeId = this.ids.next()
    await this.challenges.add({
      id: challengeId,
      challenge,
      purpose: 'login',
      userId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
    })
    return { challengeId, options }
  }
}

/** Step 2: the passkey names its owner; a valid signature over our challenge is the sign-in. */
export class FinishPasskeyLogin {
  constructor(
    private assertions: PasskeyAssertions,
    private users: UserRepository,
    private starter: SessionStarter,
    private uow: UnitOfWork,
  ) {}

  async execute(cmd: {
    challengeId: string
    response: WebAuthnResponse
    meta: SessionMeta
  }): Promise<VerifyMagicLinkResult> {
    const passkey = await this.assertions.verify({
      purpose: 'login',
      challengeId: cmd.challengeId,
      response: cmd.response,
    })
    const user = await this.users.findById(passkey.userId)
    if (!user)
      throw new UnauthorizedError('passkey_not_recognized', 'This passkey is not registered')

    const session = await this.uow.run(() =>
      this.starter.start({ userId: user.id, meta: cmd.meta, method: 'passkey' }),
    )
    return { user: { id: user.id, email: user.email.value }, session }
  }
}
