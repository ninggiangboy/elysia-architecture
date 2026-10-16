import type { Email } from '../../domain/email'

export interface TokenService {
  /** Unguessable random token + hash to store in the DB. */
  newOpaqueToken(): { token: string; hash: string }
  hashOpaqueToken(token: string): string
  signAccessToken(claims: {
    userId: string
    sessionId: string
  }): Promise<{ token: string; expiresInSeconds: number }>
}

export interface MagicLinkThrottle {
  isAllowed(email: Email, ip: string, now: Date): Promise<boolean>
}
