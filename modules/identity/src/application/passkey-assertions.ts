import type { Clock } from '@kit/core'
import { UnauthorizedError, ValidationError } from '@kit/core'
import type { Passkey } from '../domain/passkey'
import type { PasskeyRepository, WebAuthnChallengeRepository } from '../domain/repositories'
import type { WebAuthnResponse, WebAuthnService } from './ports'

/** Checks a passkey assertion against the challenge it answers; shared by sign-in and step-up. */
export class PasskeyAssertions {
  constructor(
    private challenges: WebAuthnChallengeRepository,
    private passkeys: PasskeyRepository,
    private webauthn: WebAuthnService,
    private clock: Clock,
  ) {}

  /**
   * Consumes the challenge (single use, even if the assertion then fails), verifies the signature and advances the passkey's
   * counter. `userId` is required for a step-up: the passkey must belong to the user who is confirming.
   */
  async verify(params: {
    purpose: 'login' | 'step_up'
    challengeId: string
    response: WebAuthnResponse
    userId?: string
  }): Promise<Passkey> {
    const now = this.clock.now()
    const challenge = await this.challenges.consume(params.challengeId, params.purpose, now)
    if (!challenge || (params.userId !== undefined && challenge.userId !== params.userId)) {
      throw new ValidationError(
        'invalid_passkey_challenge',
        'This request expired, please try again',
      )
    }
    const passkey = await this.passkeys.findByCredentialId(params.response.id)
    if (!passkey || (params.userId !== undefined && passkey.userId !== params.userId)) {
      throw new UnauthorizedError('passkey_not_recognized', 'This passkey is not registered')
    }
    const verified = await this.webauthn.verifyAuthentication({
      response: params.response,
      challenge: challenge.challenge,
      passkey,
    })
    if (!verified) throw new UnauthorizedError('passkey_rejected', 'Could not verify this passkey')

    passkey.recordUse(verified.newCounter, verified.backedUp, now)
    await this.passkeys.saveUse(passkey)
    return passkey
  }
}
