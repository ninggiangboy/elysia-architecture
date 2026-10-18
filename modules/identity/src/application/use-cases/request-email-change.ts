import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, DomainError, NotFoundError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import { EmailChangeRequest } from '../../domain/email-change-request'
import type { EmailChangeRequestRepository, UserRepository } from '../../domain/repositories'
import type { TokenService } from '../ports'

export class RequestEmailChange {
  constructor(
    private users: UserRepository,
    private requests: EmailChangeRequestRepository,
    private tokens: TokenService,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
    private stepUp: StepUpPolicy,
  ) {}

  async execute(cmd: {
    userId: string
    newEmail: string
    /** `auth_time` of the access token making the request. */
    authTime: number | undefined
  }): Promise<void> {
    // Changing the email hands over account recovery, so a stolen session alone must not be enough.
    this.stepUp.assertFresh(cmd.authTime)
    const newEmail = Email.create(cmd.newEmail)
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    if (user.email.equals(newEmail)) {
      throw new DomainError('email_unchanged', 'New email is the same as the current one')
    }
    if (await this.users.existsByEmail(newEmail)) {
      throw new ConflictError('email_taken', 'This email is already in use')
    }

    const { token, hash } = this.tokens.newOpaqueToken()
    const request = EmailChangeRequest.issue({
      id: this.ids.next(),
      userId: user.id,
      newEmail,
      rawToken: token,
      tokenHash: hash,
      now: this.clock.now(),
    })
    await this.uow.run(async () => {
      await this.requests.add(request)
      await this.outbox.add(request.pullEvents())
    })
  }
}
