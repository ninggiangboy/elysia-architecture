import type { Locale } from '@app/shared-types/locales'
import { AggregateRoot, DomainError } from '@kit/core'
import { IdentityEvents } from '../contracts/events'
import type { Email } from './email'

export class User extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    private _email: Email,
    private _locale: Locale,
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

  get updatedAt(): Date {
    return this._updatedAt
  }

  static register(params: { id: string; email: Email; locale: Locale; now: Date }): User {
    const user = new User(params.id, 0, params.email, params.locale, params.now, params.now)
    user.record(
      IdentityEvents.UserRegistered,
      {
        userId: user.id,
        email: params.email.value,
        locale: params.locale,
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
    createdAt: Date
    updatedAt: Date
  }): User {
    return new User(
      params.id,
      params.version,
      params.email,
      params.locale,
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
}
