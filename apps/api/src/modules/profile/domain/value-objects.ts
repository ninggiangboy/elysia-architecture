import { BIO_MAX, DISPLAY_NAME_MAX } from '@app/shared-types'
import { DomainError } from '#/shared/domain/errors'

const isControl = (code: number) => code < 0x20 || code === 0x7f
const hasControlChars = (s: string) => [...s].some((c) => isControl(c.charCodeAt(0)))
const stripControlChars = (s: string) => [...s].filter((c) => !isControl(c.charCodeAt(0))).join('')

export class DisplayName {
  private constructor(readonly value: string) {}

  static create(raw: string): DisplayName {
    const value = raw.trim()
    if (value.length === 0 || value.length > DISPLAY_NAME_MAX || hasControlChars(value)) {
      throw new DomainError(
        'invalid_display_name',
        `Display name must be 1-${DISPLAY_NAME_MAX} characters`,
      )
    }
    return new DisplayName(value)
  }

  /** Default name is taken from the part of the email before @. */
  static fromEmail(email: string): DisplayName {
    const local = stripControlChars(email.split('@')[0] ?? '').trim()
    return DisplayName.create((local || 'user').slice(0, DISPLAY_NAME_MAX))
  }
}

export class Bio {
  private constructor(readonly value: string) {}

  /** Empty string = clear the bio (returns null). */
  static create(raw: string): Bio | null {
    const value = raw.trim()
    if (value.length === 0) return null
    if (value.length > BIO_MAX) {
      throw new DomainError('invalid_bio', `Bio must be at most ${BIO_MAX} characters`)
    }
    return new Bio(value)
  }
}
