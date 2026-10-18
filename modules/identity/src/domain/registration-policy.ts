import { ForbiddenError, ValidationError } from '@kit/core'
import type { Email } from './email'

export type RegistrationMode = 'open' | 'invite' | 'closed'

/**
 * Who may create an account. Every way of creating one (password sign-up, first magic link, first code, first OAuth
 * sign-in) asks this, so a new sign-in method cannot forget the rules.
 */
export class RegistrationPolicy {
  constructor(
    readonly mode: RegistrationMode,
    /** Lowercase domains; undefined = any. */
    private allowedDomains: string[] | undefined,
    /** The terms a new account must accept; undefined = none. */
    readonly termsVersion: string | undefined,
    /** Lowercase addresses that may always create an account, whatever the mode (the owner who seeds an invite-only app). */
    private alwaysAllowed: string[] = [],
  ) {}

  /** Throws when `email` may not get an account. `invited` = a pending invitation exists for it. */
  assertMayRegister(email: Email, invited: boolean): void {
    if (this.alwaysAllowed.includes(email.value)) return
    if (this.mode === 'closed') {
      throw new ForbiddenError('registration_closed', 'New accounts cannot be created right now')
    }
    if (!this.domainAllowed(email)) {
      throw new ForbiddenError(
        'registration_domain_not_allowed',
        'Accounts cannot be created with this email domain',
      )
    }
    if (this.mode === 'invite' && !invited) {
      throw new ForbiddenError(
        'registration_invite_only',
        'You need an invitation to create an account',
      )
    }
  }

  /** The version to record on the account; throws if terms are required and were not accepted. */
  acceptedTerms(accepted: boolean | undefined): string | null {
    if (!this.termsVersion) return null
    if (!accepted) {
      throw new ValidationError('terms_not_accepted', 'Accept the terms to create an account')
    }
    return this.termsVersion
  }

  private domainAllowed(email: Email): boolean {
    if (!this.allowedDomains) return true
    const domain = email.value.slice(email.value.lastIndexOf('@') + 1)
    return this.allowedDomains.includes(domain)
  }
}
