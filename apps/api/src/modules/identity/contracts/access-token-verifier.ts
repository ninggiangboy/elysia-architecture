export interface AccessTokenClaims {
  userId: string
  /** = id of the refresh-token family (login session). */
  sessionId: string
}

export interface AccessTokenVerifier {
  /** Throws if the token has a bad signature, is expired, or has a wrong issuer/audience. */
  verify(token: string): Promise<AccessTokenClaims>
}
