import type { Email } from '../../domain/email'
import type { OAuthProviderId } from '../../domain/oauth-account'
import type { Passkey, PasskeyDeviceType } from '../../domain/passkey'

export interface TokenService {
  /** Unguessable random token + hash to store in the DB. */
  newOpaqueToken(): { token: string; hash: string }
  hashOpaqueToken(token: string): string
  /**
   * Keyed hash (HMAC under a server secret) for values with little entropy, such as a 6-digit code:
   * a plain hash of those falls to brute force the moment the table leaks.
   */
  keyedHash(input: string): string
  /** Random one-time code of `digits` decimal digits (for a code the user types in). */
  newNumericCode(digits: number): string
  signAccessToken(claims: {
    userId: string
    sessionId: string
    /** When the user last proved who they are; sensitive actions require it to be recent. Omit on a plain refresh. */
    authTime?: Date
  }): Promise<{ token: string; expiresInSeconds: number }>
}

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterMs: number }

export interface MagicLinkThrottle {
  /** When refused, `retryAfterMs` is how long until the oldest counted request leaves the window. */
  check(email: Email, ip: string, now: Date): Promise<ThrottleVerdict>
}

/** The credential as the browser reports it: `id` is the base64url credential id, the rest is opaque to us. */
export type WebAuthnResponse = { id: string } & Record<string, unknown>

export interface RegisteredCredential {
  credentialId: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  deviceType: PasskeyDeviceType
  backedUp: boolean
}

export interface CredentialRef {
  credentialId: string
  transports: string[]
}

/** WebAuthn relying-party operations. `options` is the JSON the browser passes to `navigator.credentials`. */
export interface WebAuthnService {
  registrationOptions(params: {
    userId: string
    userName: string
    existing: CredentialRef[]
  }): Promise<{ challenge: string; options: unknown }>
  /** null when the attestation does not check out (wrong challenge/origin, missing user verification…). */
  verifyRegistration(params: {
    response: WebAuthnResponse
    challenge: string
  }): Promise<RegisteredCredential | null>
  /** Without `allow` the browser offers any passkey it holds for this site (usernameless sign-in). */
  authenticationOptions(params: {
    allow?: CredentialRef[]
  }): Promise<{ challenge: string; options: unknown }>
  /** null when the assertion does not check out. */
  verifyAuthentication(params: {
    response: WebAuthnResponse
    challenge: string
    passkey: Passkey
  }): Promise<{ newCounter: number; backedUp: boolean } | null>
}

export interface OAuthProfile {
  /** The provider's stable id for the person. */
  providerUserId: string
  email: string | null
  /** True only when the provider vouches that the user controls `email`. */
  emailVerified: boolean
  /** The name the provider knows the person by, offered as the display name of a new account. */
  displayName?: string | null
}

/** Talks to Google, GitHub, Microsoft, Discord and configured OIDC providers. Only configured providers are enabled. */
export interface OAuthGateway {
  enabledProviders(): OAuthProviderId[]
  /** Names for the sign-in buttons; a provider missing here is shown under its id. */
  providerNames?(): Record<OAuthProviderId, string>
  /** Async because an OIDC provider's endpoints come from its discovery document. */
  authorizationUrl(
    provider: OAuthProviderId,
    params: { state: string; codeVerifier: string },
  ): string | Promise<string>
  /** null when the provider rejects the code (expired, already used, wrong verifier). */
  exchange(
    provider: OAuthProviderId,
    params: { code: string; codeVerifier: string },
  ): Promise<OAuthProfile | null>
}

/** Slow, salted password hashing (argon2id). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>
  /**
   * `hash` null (no such account, or one without a password) burns the time a real check takes and answers false, so
   * response time does not tell which addresses are registered.
   */
  verify(plain: string, hash: string | null): Promise<boolean>
}
