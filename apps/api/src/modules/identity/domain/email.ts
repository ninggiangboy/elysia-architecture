import { DomainError } from '#/shared/domain/errors'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Value object: normalized email (trim + lowercase). */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const value = raw.trim().toLowerCase()
    if (value.length > 254 || !EMAIL_RE.test(value)) {
      throw new DomainError('invalid_email', 'Email address is not valid')
    }
    return new Email(value)
  }

  equals(other: Email): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
