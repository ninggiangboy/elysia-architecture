import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, NotFoundError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { Email } from '../../domain/email'
import {
  INVITATION_TTL_MS,
  INVITATIONS_MAX_PER_DAY,
  INVITATIONS_WINDOW_MS,
  type Invitation,
  type InvitationStatus,
  invitationStatus,
} from '../../domain/invitation'
import type { InvitationRepository, UserRepository } from '../../domain/repositories'
import type { AuthPolicy } from '../auth-policy'
import { invitationSent } from '../security-events'
import { assertUnderLimit } from '../throttle'

export interface InvitationView {
  id: string
  email: string
  status: InvitationStatus
  createdAt: Date
  expiresAt: Date
}

const toView = (invitation: Invitation, now: Date): InvitationView => ({
  id: invitation.id,
  email: invitation.email,
  status: invitationStatus(invitation, now),
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
})

/** In `invite` mode a member lets an address create an account; the mail tells the person to sign in with it. */
export class SendInvitation {
  constructor(
    private users: UserRepository,
    private invitations: InvitationRepository,
    private policy: AuthPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; email: string }): Promise<InvitationView> {
    if (this.policy.registration.mode !== 'invite') {
      throw new NotFoundError('invitations_unavailable', 'Invitations are not used here')
    }
    const email = Email.create(cmd.email)
    const now = this.clock.now()
    assertUnderLimit({
      seen: await this.invitations.sentSince(
        cmd.userId,
        new Date(now.getTime() - INVITATIONS_WINDOW_MS),
      ),
      max: INVITATIONS_MAX_PER_DAY,
      windowMs: INVITATIONS_WINDOW_MS,
      now,
      code: 'invitation_rate_limited',
    })
    const inviter = await this.users.findById(cmd.userId)
    if (!inviter) throw new NotFoundError('user_not_found', 'User not found')
    // A member asking is already inside, so telling them the address is taken leaks nothing they could not learn.
    if (await this.users.existsByEmail(email)) {
      throw new ConflictError('already_a_member', 'This person already has an account')
    }
    if (await this.invitations.hasPending(email, now)) {
      throw new ConflictError('invitation_exists', 'This address has already been invited')
    }
    const invitation: Invitation = {
      id: this.ids.next(),
      email: email.value,
      invitedBy: cmd.userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    }
    await this.uow.run(async () => {
      await this.invitations.add(invitation)
      await this.outbox.add([
        invitationSent(
          {
            invitationId: invitation.id,
            email: invitation.email,
            invitedBy: cmd.userId,
            inviterEmail: inviter.email.value,
            expiresAt: invitation.expiresAt.toISOString(),
          },
          now,
        ),
      ])
    })
    return toView(invitation, now)
  }
}

export class ListInvitations {
  constructor(
    private invitations: InvitationRepository,
    private clock: Clock,
  ) {}

  async execute(query: { userId: string }): Promise<InvitationView[]> {
    const now = this.clock.now()
    return (await this.invitations.listByInviter(query.userId)).map((i) => toView(i, now))
  }
}

export class RevokeInvitation {
  constructor(
    private invitations: InvitationRepository,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; invitationId: string }): Promise<void> {
    if (!(await this.invitations.revoke(cmd.userId, cmd.invitationId, this.clock.now()))) {
      throw new NotFoundError('invitation_not_found', 'Invitation not found')
    }
  }
}
