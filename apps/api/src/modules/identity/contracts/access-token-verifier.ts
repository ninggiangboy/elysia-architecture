export interface AccessTokenClaims {
  userId: string
  /** = id of the refresh-token family (login session). */
  sessionId: string
  /**
   * Epoch seconds of the user's last strong authentication (sign-in, or a later step-up). Absent on tokens issued by a
   * plain refresh — sensitive actions then ask the user to confirm again.
   */
  authTime?: number
}

export interface AccessTokenVerifier {
  /** Throws if the token has a bad signature, is expired, or has a wrong issuer/audience. */
  verify(token: string): Promise<AccessTokenClaims>
}
