import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { TooManyRequestsError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import { MagicLink } from '../../domain/magic-link'
import type { MagicLinkRepository } from '../../domain/repositories'
import type { MagicLinkThrottle, TokenService } from '../ports'

export class RequestMagicLink {
  constructor(
    private magicLinks: MagicLinkRepository,
    private throttle: MagicLinkThrottle,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { email: string; ip: string; locale?: Locale }): Promise<void> {
    const email = Email.create(cmd.email)
    const now = this.clock.now()

    const verdict = await this.throttle.check(email, cmd.ip, now)
    if (!verdict.allowed) {
      throw new TooManyRequestsError(
        'magic_link_rate_limited',
        'Too many requests, try again later',
        Math.ceil(verdict.retryAfterMs / 1000),
      )
    }

    const { token, hash } = this.tokens.newOpaqueToken()
    const link = MagicLink.issue({
      id: this.ids.next(),
      email,
      rawToken: token,
      tokenHash: hash,
      requestedIp: cmd.ip,
      locale: cmd.locale ?? DEFAULT_LOCALE,
      now,
    })

    await this.uow.run(async () => {
      await this.magicLinks.add(link)
      await this.outbox.add(link.pullEvents())
    })
  }
}
