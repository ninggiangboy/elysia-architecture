import type { PasswordHasher } from '../application/ports'

/**
 * argon2id with the OWASP minimum parameters (19 MiB, 2 passes, 1 lane), through Bun's native implementation. The hash is a
 * PHC string carrying its own salt and parameters, so raising the cost later does not break existing hashes.
 */
export class BunPasswordHasher implements PasswordHasher {
  private dummy: Promise<string> | undefined

  hash(plain: string): Promise<string> {
    return Bun.password.hash(plain, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 })
  }

  async verify(plain: string, hash: string | null): Promise<boolean> {
    if (hash === null) {
      this.dummy ??= this.hash('this is not anyone’s password')
      await Bun.password.verify(plain, await this.dummy).catch(() => false)
      return false
    }
    return Bun.password.verify(plain, hash).catch(() => false)
  }
}
