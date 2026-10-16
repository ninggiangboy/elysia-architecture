import { ConflictError, ValidationError } from '#/shared/application/errors'
import type { Clock, IdGenerator, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
import type { MagicLinkRepository, UserRepository } from '../../domain/repositories'
import { User } from '../../domain/user'
import type { TokenService } from '../ports'
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

  async execute(cmd: { token: string; meta: SessionMeta }): Promise<VerifyMagicLinkResult> {
    try {
      return await this.attempt(cmd)
    } catch (err) {
      // Hai link của cùng email chưa có tài khoản được verify đồng thời → một bên thua unique(email).
      // Transaction đã rollback (link được trả lại) nên chạy lại một lần sẽ thấy user vừa được tạo.
      if (err instanceof ConflictError && err.code === 'email_taken') return this.attempt(cmd)
      throw err
    }
  }

  private async attempt(cmd: { token: string; meta: SessionMeta }): Promise<VerifyMagicLinkResult> {
    const now = this.clock.now()
    const hash = this.tokens.hashOpaqueToken(cmd.token)

    const result = await this.uow.run(async () => {
      const link = await this.magicLinks.consume(hash, now)
      if (!link) return null

      let user = await this.users.findByEmail(link.email)
      if (!user) {
        user = User.register({ id: this.ids.next(), email: link.email, now })
        await this.users.save(user)
        await this.outbox.add(user.pullEvents())
      }
      const session = await this.sessions.issue({ userId: user.id, meta: cmd.meta })
      return { user: { id: user.id, email: user.email.value }, session }
    })

    if (!result)
      throw new ValidationError('invalid_magic_link', 'This link is invalid or has expired')
    return result
  }
}
