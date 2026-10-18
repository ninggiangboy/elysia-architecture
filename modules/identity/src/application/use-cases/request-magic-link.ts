import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { NotFoundError, TooManyRequestsError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import { MAGIC_LINK_CODE_DIGITS, MagicLink } from '../../domain/magic-link'
import type {
  InvitationRepository,
  MagicLinkRepository,
  UserRepository,
} from '../../domain/repositories'
import type { AuthPolicy } from '../auth-policy'
import type { MagicLinkThrottle, TokenService } from '../ports'

/** What the mail's code is bound to: the address it was sent to, so a code cannot be tried against another account. */
export const emailCodeHash = (tokens: TokenService, email: Email, code: string) =>
  tokens.keyedHash(`email-code:${email.value}:${code}`)

export class RequestMagicLink {
  constructor(
    private magicLinks: MagicLinkRepository,
    private users: UserRepository,
    private invitations: InvitationRepository,
    private throttle: MagicLinkThrottle,
    private tokens: TokenService,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { email: string; ip: string; locale?: Locale }): Promise<void> {
    if (!this.policy.has('email')) {
      throw new NotFoundError('sign_in_method_unavailable', 'This sign-in method is not available')
    }
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

    // Where nobody may create an account, a stranger's address gets no mail — and the answer is the same 202, so the
    // form does not reveal which addresses are members.
    if (!(await this.users.existsByEmail(email)) && !(await this.mayRegister(email))) return

    const { token, hash } = this.tokens.newOpaqueToken()
    const code = this.tokens.newNumericCode(MAGIC_LINK_CODE_DIGITS)
    const link = MagicLink.issue({
      id: this.ids.next(),
      email,
      rawToken: token,
      tokenHash: hash,
      rawCode: code,
      codeHash: emailCodeHash(this.tokens, email, code),
      requestedIp: cmd.ip,
      locale: cmd.locale ?? DEFAULT_LOCALE,
      now,
    })

    await this.uow.run(async () => {
      await this.magicLinks.add(link)
      await this.outbox.add(link.pullEvents())
    })
  }

  private async mayRegister(email: Email): Promise<boolean> {
    try {
      this.policy.registration.assertMayRegister(
        email,
        await this.invitations.hasPending(email, this.clock.now()),
      )
      return true
    } catch {
      return false
    }
  }
}
