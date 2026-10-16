import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest()

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BE = 0x08
const FLAG_BS = 0x10
const FLAG_AT = 0x40

interface Options {
  rpId: string
  origin: string
}

/**
 * A WebAuthn authenticator in software (ES256, "none" attestation), so the real relying-party code can be exercised end
 * to end without a browser. By default it counts like a hardware key; `syncedPasskey` mimics iCloud/Google passkeys,
 * which report a counter of 0 forever.
 */
export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32)
  counter = 0
  private keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  private rpIdHash: Buffer

  constructor(
    private options: Options,
    private behaviour: { syncedPasskey?: boolean; userVerified?: boolean } = {},
  ) {
    this.rpIdHash = sha256(new TextEncoder().encode(options.rpId))
  }

  get id(): string {
    return isoBase64URL.fromBuffer(this.credentialId)
  }

  private flags(extra: number) {
    const uv = this.behaviour.userVerified === false ? 0 : FLAG_UV
    const backup = this.behaviour.syncedPasskey ? FLAG_BE | FLAG_BS : 0
    return FLAG_UP | uv | backup | extra
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin?: string) {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin ?? this.options.origin,
        crossOrigin: false,
      }),
    )
  }

  /** `navigator.credentials.create()` for the options the server sent. */
  create(options: { challenge: string }, overrides: { origin?: string } = {}) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' })
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, isoBase64URL.toBuffer(jwk.x as string)],
        [-3, isoBase64URL.toBuffer(jwk.y as string)],
      ]),
    )
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    const credentialIdLength = Buffer.alloc(2)
    credentialIdLength.writeUInt16BE(this.credentialId.length)
    const authData = Buffer.concat([
      this.rpIdHash,
      Buffer.from([this.flags(FLAG_AT)]),
      counter,
      Buffer.alloc(16), // AAGUID
      credentialIdLength,
      this.credentialId,
      coseKey,
    ])
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never,
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(
          this.clientData('webauthn.create', options.challenge, overrides.origin),
        ),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    }
  }

  /** `navigator.credentials.get()` for the options the server sent. */
  get(options: { challenge: string }, overrides: { origin?: string; counter?: number } = {}) {
    if (!this.behaviour.syncedPasskey) this.counter = overrides.counter ?? this.counter + 1
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    const authData = Buffer.concat([this.rpIdHash, Buffer.from([this.flags(0)]), counter])
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, overrides.origin)
    const signature = createSign('sha256')
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign({ key: this.keys.privateKey, dsaEncoding: 'der' })
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
      clientExtensionResults: {},
    }
  }
}
