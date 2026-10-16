import { MailPermanentError } from '#/shared/application/mail-errors'
import type {
  Clock,
  InboxGuard,
  IntegrationEventHandler,
  Log,
  Mailer,
} from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { MailContent } from '../templates'

export interface MailRequest {
  to: string
  content: MailContent
  /** ISO-8601. Qua thời điểm này mail vô nghĩa (vd. link hết hạn) → bỏ qua thay vì gửi trễ. */
  expiresAt?: string
}

/**
 * Handler chung: event → mail → gửi, ghi inbox sau khi xử lý xong (at-least-once).
 *  - Hết hạn: bỏ qua (không gửi một link đã chết).
 *  - MailPermanentError: bỏ mail này và ghi log lỗi — không để một địa chỉ hỏng chặn/đưa cả event vào dead.
 *  - MailRateLimitedError / lỗi khác: ném lên để relay hoãn hoặc retry.
 */
export class MailEventHandler<TPayload> implements IntegrationEventHandler {
  constructor(
    readonly name: string,
    readonly eventType: string,
    private build: (payload: TPayload) => MailRequest,
    private mailer: Mailer,
    private inbox: InboxGuard,
    private clock: Clock,
    private log: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { to, content, expiresAt } = this.build(message.payload as unknown as TPayload)
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
