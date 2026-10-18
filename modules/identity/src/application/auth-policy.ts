import type { SignInMethod } from '../config'
import type { RegistrationPolicy } from '../domain/registration-policy'

/** What this deployment offers: which ways to sign in, who may sign up, whether 2FA exists. */
export class AuthPolicy {
  constructor(
    private methods: ReadonlySet<SignInMethod>,
    readonly registration: RegistrationPolicy,
    readonly passwordMinLength: number,
    readonly twoFactor: boolean,
    readonly termsUrl: string | undefined,
  ) {}

  has(method: SignInMethod): boolean {
    return this.methods.has(method)
  }

  describe() {
    return {
      methods: [...this.methods],
      registration: this.registration.mode,
      passwordMinLength: this.passwordMinLength,
      twoFactor: this.twoFactor,
      termsVersion: this.registration.termsVersion ?? null,
      termsUrl: this.termsUrl ?? null,
    }
  }
}
