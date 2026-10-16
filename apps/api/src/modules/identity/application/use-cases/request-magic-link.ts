import { TooManyRequestsError } from '#/shared/application/errors'
import type { Clock, IdGenerator, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
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

  async execute(cmd: { email: string; ip: string }): Promise<void> {
    const email = Email.create(cmd.email)
    const now = this.clock.now()

    if (!(await this.throttle.isAllowed(email, cmd.ip, now))) {
      throw new TooManyRequestsError(
        'magic_link_rate_limited',
        'Too many requests, try again later',
      )
    }

    const { token, hash } = this.tokens.newOpaqueToken()
    const link = MagicLink.issue({
      id: this.ids.next(),
      email,
      rawToken: token,
      tokenHash: hash,
      requestedIp: cmd.ip,
      now,
    })

    await this.uow.run(async () => {
      await this.magicLinks.add(link)
      await this.outbox.add(link.pullEvents())
    })
  }
}
