import { NotFoundError, ValidationError } from '#/shared/application/errors'
import type { Clock, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
import type { EmailChangeRequestRepository, UserRepository } from '../../domain/repositories'
import type { TokenService } from '../ports'

export class ConfirmEmailChange {
  constructor(
    private users: UserRepository,
    private requests: EmailChangeRequestRepository,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { token: string }): Promise<{ email: string }> {
    const now = this.clock.now()
    const hash = this.tokens.hashOpaqueToken(cmd.token)

    const result = await this.uow.run(async () => {
      const request = await this.requests.consume(hash, now)
      if (!request) return null

      const user = await this.users.findById(request.userId)
      if (!user) throw new NotFoundError('user_not_found', 'User not found')
      // Email bị người khác chiếm trong lúc chờ → save() ném ConflictError('email_taken') và rollback cả việc consume.
      user.changeEmail(request.newEmail, now)
      await this.users.save(user)
      await this.outbox.add(user.pullEvents())
      return { email: user.email.value }
    })

    if (!result) {
      throw new ValidationError('invalid_email_change_token', 'This link is invalid or has expired')
    }
    return result
  }
}
