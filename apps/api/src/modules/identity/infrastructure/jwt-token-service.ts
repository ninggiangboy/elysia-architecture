import {
  type CryptoKey,
  exportJWK,
  importPKCS8,
  importSPKI,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose'
import type { IdGenerator } from '#/shared/application/ports'
import { randomToken, sha256Hex } from '#/shared/infrastructure/crypto'
import type { TokenService } from '../application/ports'
import type { AccessTokenClaims, AccessTokenVerifier } from '../contracts/access-token-verifier'

export interface JwtOptions {
  privateKeyPem: string
  publicKeyPem: string
  kid: string
  issuer: string
  audience: string
  accessTtlSeconds: number
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

  async signAccessToken(claims: { userId: string; sessionId: string }) {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ sid: claims.sessionId })
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
    return { userId: payload.sub, sessionId: payload.sid }
  }
}
