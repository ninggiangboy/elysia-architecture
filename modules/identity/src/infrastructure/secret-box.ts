import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'

/**
 * AES-256-GCM for secrets the server must read back (TOTP seeds), unlike passwords and tokens, which are hashed.
 * The key is derived from the configured passphrase; the output is `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export class SecretBox {
  private key: Buffer

  constructor(passphrase: string) {
    this.key = createHash('sha256').update(`identity.secret-box:${passphrase}`).digest()
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.')
  }

  /** Throws when the value was sealed under another key or tampered with. */
  open(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split('.')
    if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Malformed sealed value')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
