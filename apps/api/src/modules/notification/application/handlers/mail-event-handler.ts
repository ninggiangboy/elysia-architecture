import type { Locale } from '@app/shared-types/locales'
import type { Clock, Log } from '#/shared/core'
import type { Mailer } from '#/shared/mail'
import { MailPermanentError } from '#/shared/mail'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '#/shared/messaging'
import type { LocaleResolver, Recipient } from '../../contracts'
import type { MailContent } from '../mail-composer'
import { payloadLocale } from '../payload-locale'

export interface MailRequest {
  to: string
  content: MailContent
  /** ISO-8601. After this time the mail is pointless (e.g. link expired) → skip instead of sending late. */
  expiresAt?: string
}

/**
 * Generic handler: event → mail → send, record in the inbox once done (at-least-once).
 *  - Expired: skip (do not send a dead link).
 *  - MailPermanentError: drop this mail and log the error — a bad address must not block or send the whole event to dead.
 *  - MailRateLimitedError / other errors: rethrow so the relay defers or retries.
 */
export class MailEventHandler<TPayload> implements IntegrationEventHandler {
  constructor(
    readonly name: string,
    readonly eventType: string,
    private build: (payload: TPayload, locale: Locale) => MailRequest,
    private mailer: Mailer,
    private inbox: InboxGuard,
    private clock: Clock,
    private log: Log,
    private locales: LocaleResolver = payloadLocale,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const payload = message.payload as unknown as TPayload
    const locale = await this.locales.resolve(payload as Recipient)
    const { to, content, expiresAt } = this.build(payload, locale)
    await this.inbox.afterSideEffect(message.id, this.name, async () => {
      if (expiresAt && this.clock.now() > new Date(expiresAt)) {
        this.log.info(
          { messageId: message.id, handler: this.name },
          'mail skipped: expired before it could be sent',
        )
        return
      }
      try {
        await this.mailer.send({ to, ...content })
      } catch (err) {
        if (!(err instanceof MailPermanentError)) throw err
        this.log.error(
          { messageId: message.id, handler: this.name, reason: err.message },
          'mail permanently rejected, dropping',
        )
      }
    })
  }
}
