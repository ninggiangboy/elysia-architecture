import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  CredentialRef,
  RegisteredCredential,
  WebAuthnResponse,
  WebAuthnService,
} from '../application/ports'
import type { Passkey } from '../domain/passkey'

export interface WebAuthnOptions {
  rpId: string
  rpName: string
  /** Origins the browser may report (scheme + host + port of the web app). */
  origins: string[]
}

const transports = (list: string[]) => list as AuthenticatorTransport[]
const refs = (list: CredentialRef[]) =>
  list.map((c) => ({ id: c.credentialId, transports: transports(c.transports) }))

/**
 * Relying party on top of @simplewebauthn/server. Passkeys are discoverable and always require user verification
 * (biometrics / PIN): a passkey is a complete sign-in on its own, so "something you have" alone is not enough.
 */
export class SimpleWebAuthnService implements WebAuthnService {
  constructor(private options: WebAuthnOptions) {}

  async registrationOptions(params: {
    userId: string
    userName: string
    existing: CredentialRef[]
  }) {
    const options = await generateRegistrationOptions({
      rpName: this.options.rpName,
      rpID: this.options.rpId,
      userName: params.userName,
      userID: new TextEncoder().encode(params.userId),
      attestationType: 'none',
      excludeCredentials: refs(params.existing),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    return { challenge: options.challenge, options }
  }

  async verifyRegistration(params: {
    response: WebAuthnResponse
    challenge: string
  }): Promise<RegisteredCredential | null> {
    try {
      const response = params.response as unknown as RegistrationResponseJSON
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: params.challenge,
        expectedOrigin: this.options.origins,
        expectedRPID: this.options.rpId,
        requireUserVerification: true,
      })
      if (!result.verified) return null
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ?? response.response.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      }
    } catch {
      return null
    }
  }

  async authenticationOptions(params: { allow?: CredentialRef[] }) {
    const options = await generateAuthenticationOptions({
      rpID: this.options.rpId,
      userVerification: 'required',
      allowCredentials: params.allow ? refs(params.allow) : undefined,
    })
    return { challenge: options.challenge, options }
  }

  async verifyAuthentication(params: {
    response: WebAuthnResponse
    challenge: string
    passkey: Passkey
  }) {
    try {
      const result = await verifyAuthenticationResponse({
        response: params.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: params.challenge,
        expectedOrigin: this.options.origins,
        expectedRPID: this.options.rpId,
        requireUserVerification: true,
        credential: {
          id: params.passkey.credentialId,
          publicKey: params.passkey.publicKey as Uint8Array<ArrayBuffer>,
          counter: params.passkey.counter,
          transports: transports(params.passkey.transports),
        },
      })
      if (!result.verified) return null
      return {
        newCounter: result.authenticationInfo.newCounter,
        backedUp: result.authenticationInfo.credentialBackedUp,
      }
    } catch {
      return null
    }
  }
}
