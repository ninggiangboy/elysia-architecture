import type { Locale } from '@app/shared-types/locales'
import { AggregateRoot, DomainError } from '@kit/core'
import { IdentityEvents } from '../contracts/events'
import type { Email } from './email'

/** What a password change was, for `password_changed`. */
export type PasswordChange = 'set' | 'changed' | 'removed' | 'reset'

export class User extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    private _email: Email,
    private _locale: Locale,
    private _passwordHash: string | null,
    private _passwordChangedAt: Date | null,
    readonly termsVersion: string | null,
    readonly termsAcceptedAt: Date | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {
    super(id, version)
  }

  get email(): Email {
    return this._email
  }

  get locale(): Locale {
    return this._locale
  }

  get passwordHash(): string | null {
    return this._passwordHash
  }

  get hasPassword(): boolean {
    return this._passwordHash !== null
  }

  get passwordChangedAt(): Date | null {
    return this._passwordChangedAt
  }

  get updatedAt(): Date {
    return this._updatedAt
  }

  /** Only called once the email is proven: an account never exists for an address nobody controls. */
  static register(params: {
    id: string
    email: Email
    locale: Locale
    now: Date
    /** How the email was proven: `magic_link`, `email_code`, `password`, `oauth:<provider>`. */
    method?: string
    displayName?: string | null
    passwordHash?: string | null
    termsVersion?: string | null
  }): User {
    const user = new User(
      params.id,
      0,
      params.email,
      params.locale,
      params.passwordHash ?? null,
      params.passwordHash ? params.now : null,
      params.termsVersion ?? null,
      params.termsVersion ? params.now : null,
      params.now,
      params.now,
    )
    user.record(
      IdentityEvents.UserRegistered,
      {
        userId: user.id,
        email: params.email.value,
        locale: params.locale,
        ...(params.displayName && { displayName: params.displayName }),
        ...(params.method && { method: params.method }),
        registeredAt: params.now.toISOString(),
      },
      params.now,
    )
    return user
  }

  static restore(params: {
    id: string
    version: number
    email: Email
    locale: Locale
    passwordHash?: string | null
    passwordChangedAt?: Date | null
    termsVersion?: string | null
    termsAcceptedAt?: Date | null
    createdAt: Date
    updatedAt: Date
  }): User {
    return new User(
      params.id,
      params.version,
      params.email,
      params.locale,
      params.passwordHash ?? null,
      params.passwordChangedAt ?? null,
      params.termsVersion ?? null,
      params.termsAcceptedAt ?? null,
      params.createdAt,
      params.updatedAt,
    )
  }

  changeLocale(locale: Locale, now: Date): void {
    if (this._locale === locale) return
    this._locale = locale
    this._updatedAt = now
  }

  changeEmail(newEmail: Email, now: Date): void {
    if (this._email.equals(newEmail)) {
      throw new DomainError('email_unchanged', 'New email is the same as the current one')
    }
    const oldEmail = this._email
    this._email = newEmail
    this._updatedAt = now
    this.record(
      IdentityEvents.EmailChanged,
      {
        userId: this.id,
        oldEmail: oldEmail.value,
        newEmail: newEmail.value,
        changedAt: now.toISOString(),
      },
      now,
    )
  }

  /** `reset` = through the forgotten-password mail; otherwise `set` (first one) or `changed`. */
  setPassword(hash: string, now: Date, viaReset = false): PasswordChange {
    const change: PasswordChange = viaReset ? 'reset' : this._passwordHash ? 'changed' : 'set'
    this._passwordHash = hash
    this._passwordChangedAt = now
    this._updatedAt = now
    this.recordPasswordChange(change, now)
    return change
  }

  removePassword(now: Date): void {
    if (!this._passwordHash) throw new DomainError('no_password', 'This account has no password')
    this._passwordHash = null
    this._passwordChangedAt = now
    this._updatedAt = now
    this.recordPasswordChange('removed', now)
  }

  private recordPasswordChange(change: PasswordChange, now: Date) {
    this.record(
      IdentityEvents.PasswordChanged,
      { userId: this.id, email: this._email.value, change, changedAt: now.toISOString() },
      now,
    )
  }
}
