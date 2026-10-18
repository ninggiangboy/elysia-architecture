import { DEFAULT_LOCALE, type Locale } from '@app/shared-types/locales'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, ValidationError } from '@kit/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { MagicLinkRepository, UserRepository } from '../../domain/repositories'
import { User } from '../../domain/user'
import type { TokenService } from '../ports'
import { sessionStarted } from '../session-events'
import type { SessionIssuer, SessionMeta, SessionTokens } from '../session-issuer'

export interface VerifyMagicLinkResult {
  user: { id: string; email: string }
  session: SessionTokens
}

export class VerifyMagicLink {
  constructor(
    private magicLinks: MagicLinkRepository,
    private users: UserRepository,
    private sessions: SessionIssuer,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    token: string
    meta: SessionMeta
    /** Language of the browser, for an account this sign-in creates. */
    locale?: Locale
  }): Promise<VerifyMagicLinkResult> {
    try {
      return await this.attempt(cmd)
    } catch (err) {
      // Two links for the same not-yet-registered email verified concurrently → one loses on unique(email).
      // The transaction rolled back (the link is returned), so retrying once will see the user that was just created.
      if (err instanceof ConflictError && err.code === 'email_taken') return this.attempt(cmd)
      throw err
    }
  }

  private async attempt(cmd: {
    token: string
    meta: SessionMeta
    locale?: Locale
  }): Promise<VerifyMagicLinkResult> {
    const now = this.clock.now()
    const hash = this.tokens.hashOpaqueToken(cmd.token)

    const result = await this.uow.run(async () => {
      const link = await this.magicLinks.consume(hash, now)
      if (!link) return null

      let user = await this.users.findByEmail(link.email)
      const newUser = !user
      if (!user) {
        user = User.register({
          id: this.ids.next(),
          email: link.email,
          locale: cmd.locale ?? DEFAULT_LOCALE,
          now,
        })
        await this.users.save(user)
        await this.outbox.add(user.pullEvents())
      }
      const session = await this.sessions.issue({ userId: user.id, fresh: true, meta: cmd.meta })
      await this.outbox.add([
        sessionStarted(
          {
            userId: user.id,
            sessionId: session.sessionId,
            ip: cmd.meta.ip,
            userAgent: cmd.meta.userAgent,
            newUser,
            method: 'magic_link',
          },
          now,
        ),
      ])
      return { user: { id: user.id, email: user.email.value }, session }
    })

    if (!result)
      throw new ValidationError('invalid_magic_link', 'This link is invalid or has expired')
    return result
  }
}
