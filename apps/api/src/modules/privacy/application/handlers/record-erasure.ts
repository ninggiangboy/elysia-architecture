import type { Clock } from '@kit/core'
import type {
  Envelope,
  InboxGuard,
  IntegrationEventHandler,
  OutboxWriter,
} from '#/shared/messaging'
import { type ModuleUserDataErasedPayload, participantEvents } from '../../contracts'
import type { AccountDeletionRepository } from '../../domain/repositories'
import { accountDeleted, accountErasureProgressed } from '../privacy-events'

/**
 * One module's `<module>.user_data_erased` → tick it off. The confirmation that completes the set completes the deletion.
 * Confirmations may come late, twice, or after the deletion was declared stalled; none of that is an error.
 */
export class RecordErasure implements IntegrationEventHandler {
  readonly name: string
  readonly eventType: string

  constructor(
    private module: string,
    private deletions: AccountDeletionRepository,
    private outbox: OutboxWriter,
    private inbox: InboxGuard,
    private clock: Clock,
  ) {
    this.name = `privacy.record-erasure:${module}`
    this.eventType = participantEvents(module).userDataErased
  }

  async handle(message: Envelope): Promise<void> {
    const answer = message.payload as unknown as ModuleUserDataErasedPayload
    const now = this.clock.now()
    await this.inbox.transactional(message.id, this.name, async () => {
      // Locked: two modules confirming at once must not both conclude that the other one is still missing.
      const deletion = await this.deletions.findById(answer.deletionId, { lock: true })
      if (!deletion || deletion.userId !== answer.userId) return
      const { email, locale } = deletion
      // `module` comes from the wiring, not the payload: a module can only confirm for itself.
      if (deletion.confirm(this.module, now) !== 'recorded') return
      const { done, total } = deletion.progress()
      const events = [
        accountErasureProgressed(
          { deletionId: deletion.id, userId: deletion.userId, module: this.module, done, total },
          now,
        ),
      ]
      if (deletion.isErased()) {
        deletion.complete(now)
        if (email)
          events.push(
            accountDeleted(
              { deletionId: deletion.id, userId: deletion.userId, email, locale },
              now,
            ),
          )
      }
      await this.deletions.save(deletion)
      await this.outbox.add(events)
    })
  }
}
