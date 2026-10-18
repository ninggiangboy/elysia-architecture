import { DEFAULT_LOCALE, matchLocale } from '@app/shared-types/locales'
import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, NotFoundError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { IdentityApi } from '@mod/identity/contracts'
import { AccountDeletion } from '../../domain/account-deletion'
import type { AccountDeletionRepository } from '../../domain/repositories'
import type { PrivacyPolicy } from '../ports'
import {
  accountDeletionCancelled,
  accountDeletionScheduled,
  erasureRequestFor,
} from '../privacy-events'
import { type DeletionView, toDeletionView } from '../views'

/**
 * Asks for the account to be erased once the grace period is over. Nothing is erased now: the user can still sign in and
 * change their mind. Needs a recent confirmation, like every other action that is hard to take back.
 */
export class ScheduleAccountDeletion {
  constructor(
    private deletions: AccountDeletionRepository,
    private identity: IdentityApi,
    private policy: PrivacyPolicy,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; authTime: number | undefined }): Promise<DeletionView> {
    this.stepUp.assertFresh(cmd.authTime)
    const account = await this.identity.getAccount(cmd.userId)
    if (!account) throw new NotFoundError('user_not_found', 'Account not found')

    const now = this.clock.now()
    const deletion = AccountDeletion.schedule({
      id: this.ids.next(),
      userId: cmd.userId,
      email: account.email,
      locale: matchLocale(account.locale) ?? DEFAULT_LOCALE,
      now,
      gracePeriodMs: this.policy.deletionGraceMs,
    })
    await this.uow.run(async () => {
      await this.deletions.add(deletion)
      await this.outbox.add([
        accountDeletionScheduled(
          {
            deletionId: deletion.id,
            userId: cmd.userId,
            email: account.email,
            locale: deletion.locale,
            scheduledFor: deletion.props.scheduledFor.toISOString(),
          },
          now,
        ),
      ])
    })
    return toDeletionView(deletion)
  }
}

/** Changing one's mind needs no confirmation: it only undoes a request, and it is possible only before anything is erased. */
export class CancelAccountDeletion {
  constructor(
    private deletions: AccountDeletionRepository,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string }): Promise<void> {
    const now = this.clock.now()
    await this.uow.run(async () => {
      // Locked: the scheduler may be starting this very deletion.
      const deletion = await this.deletions.findActiveByUser(cmd.userId, { lock: true })
      if (!deletion)
        throw new NotFoundError('no_deletion_scheduled', 'No account deletion is scheduled')
      const { email, locale } = deletion
      deletion.cancel(now)
      await this.deletions.save(deletion)
      if (email)
        await this.outbox.add([
          accountDeletionCancelled(
            { deletionId: deletion.id, userId: cmd.userId, email, locale },
            now,
          ),
        ])
    })
  }
}

/** The user's deletion in play, with the progress of the erasure; `null` when there is none. */
export class GetAccountDeletion {
  constructor(private deletions: AccountDeletionRepository) {}

  async execute(query: { userId: string }): Promise<DeletionView | null> {
    const deletion = await this.deletions.findActiveByUser(query.userId)
    return deletion ? toDeletionView(deletion) : null
  }
}

/** Operator action: a stalled erasure whose cause has been fixed gets another round of requests. */
export class ResumeStalledDeletion {
  constructor(
    private deletions: AccountDeletionRepository,
    private uow: UnitOfWork,
    private outbox: OutboxWriter,
    private clock: Clock,
  ) {}

  async execute(cmd: { deletionId: string }): Promise<void> {
    const now = this.clock.now()
    await this.uow.run(async () => {
      const deletion = await this.deletions.findById(cmd.deletionId, { lock: true })
      if (!deletion) throw new NotFoundError('deletion_not_found', 'Deletion not found')
      if (deletion.status !== 'stalled')
        throw new ConflictError('deletion_not_stalled', 'The deletion is not stalled')
      deletion.resume(now)
      await this.deletions.save(deletion)
      await this.outbox.add([erasureRequestFor(deletion, now)])
    })
  }
}
