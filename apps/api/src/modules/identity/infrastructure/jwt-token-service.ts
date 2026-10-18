import type { IdGenerator } from '@kit/core'
import {
  type CryptoKey,
  exportJWK,
  importPKCS8,
  importSPKI,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose'
import { hmacSha256Hex, randomDigits, randomToken, sha256Hex } from '#/shared/auth'
import type { TokenService } from '../application/ports'
import type { AccessTokenClaims, AccessTokenVerifier } from '../contracts/access-token-verifier'

export interface JwtOptions {
  privateKeyPem: string
  publicKeyPem: string
  kid: string
  issuer: string
  audience: string
  accessTtlSeconds: number
  /** Key of `keyedHash`. Changing it invalidates every code issued under the old one. */
  hashSecret: string
}

const ALG = 'ES256'

/** Signs/verifies ES256 access tokens. The public key is published via JWKS so other services can verify without a shared secret. */
export class JwtTokenService implements TokenService, AccessTokenVerifier {
  private constructor(
    private options: JwtOptions,
    private privateKey: CryptoKey,
    private publicKey: CryptoKey,
    readonly jwks: { keys: JWK[] },
    private ids: IdGenerator,
  ) {}

  static async create(options: JwtOptions, ids: IdGenerator): Promise<JwtTokenService> {
    const privateKey = await importPKCS8(options.privateKeyPem, ALG)
    const publicKey = await importSPKI(options.publicKeyPem, ALG, { extractable: true })
    const jwk = await exportJWK(publicKey)
    const jwks = { keys: [{ ...jwk, kid: options.kid, alg: ALG, use: 'sig' }] }
    return new JwtTokenService(options, privateKey, publicKey, jwks, ids)
  }

  newOpaqueToken() {
    const token = randomToken()
    return { token, hash: sha256Hex(token) }
  }

  hashOpaqueToken(token: string): string {
    return sha256Hex(token)
  }

  keyedHash(input: string): string {
    return hmacSha256Hex(this.options.hashSecret, input)
  }

  newNumericCode(digits: number): string {
    return randomDigits(digits)
  }

  async signAccessToken(claims: { userId: string; sessionId: string; authTime?: Date }) {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      sid: claims.sessionId,
      ...(claims.authTime && { auth_time: Math.floor(claims.authTime.getTime() / 1000) }),
    })
      .setProtectedHeader({ alg: ALG, kid: this.options.kid })
      .setSubject(claims.userId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setJti(this.ids.next())
      .setIssuedAt(now)
      .setExpirationTime(now + this.options.accessTtlSeconds)
      .sign(this.privateKey)
    return { token, expiresInSeconds: this.options.accessTtlSeconds }
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: [ALG],
      issuer: this.options.issuer,
      audience: this.options.audience,
    })
    if (!payload.sub || typeof payload.sid !== 'string') throw new Error('Malformed token claims')
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
    }
  }
}
