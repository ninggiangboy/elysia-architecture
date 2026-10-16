import type {
  Clock,
  InboxGuard,
  IntegrationEventHandler,
  OutboxWriter,
} from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { ModuleDataExportedPayload } from '../../contracts'
import { participantEvents } from '../../contracts'
import type { DataExportRepository } from '../../domain/repositories'
import { dataExportProgressed, exportCollected } from '../privacy-events'

/**
 * One module's `<module>.data_exported` → tick it off. The module that completes the set also starts the assembly.
 * One handler per participant, so each answer is its own consumer group with its own retries.
 */
export class RecordExportPart implements IntegrationEventHandler {
  readonly name: string
  readonly eventType: string

  constructor(
    private module: string,
    private exports: DataExportRepository,
    private outbox: OutboxWriter,
    private inbox: InboxGuard,
    private clock: Clock,
  ) {
    this.name = `privacy.record-export-part:${module}`
    this.eventType = participantEvents(module).dataExported
  }

  async handle(message: Envelope): Promise<void> {
    const answer = message.payload as unknown as ModuleDataExportedPayload
    const now = this.clock.now()
    await this.inbox.transactional(message.id, this.name, async () => {
      // Locked: two modules answering at once must not both conclude that the other one is still missing.
      const dataExport = await this.exports.findById(answer.exportId, { lock: true })
      if (!dataExport || dataExport.userId !== answer.userId) return
      // `module` comes from the wiring, not the payload: a module can only answer for itself.
      const outcome = dataExport.recordPart({ ...answer, module: this.module }, now)
      if (outcome !== 'recorded') return
      const { done, total } = dataExport.progress()
      const events = [
        dataExportProgressed(
          { exportId: dataExport.id, userId: dataExport.userId, module: this.module, done, total },
          now,
        ),
      ]
      if (dataExport.isCollected()) {
        dataExport.beginAssembly(now)
        events.push(exportCollected({ exportId: dataExport.id, userId: dataExport.userId }, now))
      }
      await this.exports.save(dataExport)
      await this.outbox.add(events)
    })
  }
}
