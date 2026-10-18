import type { Clock, Log } from '@kit/core'
import type { Envelope, InboxGuard, IntegrationEventHandler, OutboxWriter } from '@kit/messaging'
import type { IdentityApi } from '#/modules/identity/contracts'
import type { ObjectStorage } from '#/shared/storage'
import type { DataExport, ExportPart } from '../../domain/data-export'
import type { DataExportRepository } from '../../domain/repositories'
import { exportArchiveKey } from '../keys'
import type { ArchiveBuilder, ArchiveEntry, PrivacyPolicy } from '../ports'
import { dataExportFailed, dataExportReady, INTERNAL_EXPORT_COLLECTED } from '../privacy-events'

const README = (generatedAt: Date) =>
  `Your data export
================

Generated on ${generatedAt.toISOString()}.

Each file in data/ is what one part of the service holds about you, as JSON.
Files in files/ are the uploads you made (for example your avatar and cover image).
`

/**
 * Every part is in the bucket → zip them into one archive, then tell the user. Idempotent: the archive is written to a
 * fixed key, and the transition to `ready` happens once (a redelivery finds the export no longer `assembling`).
 */
export class AssembleExport implements IntegrationEventHandler {
  readonly name = 'privacy.assemble-export'
  readonly eventType = INTERNAL_EXPORT_COLLECTED

  constructor(
    private exports: DataExportRepository,
    private identity: IdentityApi,
    private storage: ObjectStorage,
    private archive: ArchiveBuilder,
    private policy: PrivacyPolicy,
    private outbox: OutboxWriter,
    private inbox: InboxGuard,
    private clock: Clock,
    private log: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { exportId } = message.payload as { exportId: string }
    const dataExport = await this.exports.findById(exportId)
    if (dataExport?.status !== 'assembling') return

    const now = this.clock.now()
    const entries = await this.entriesFor(dataExport, now)
    if (entries === 'missing') {
      await this.fail(message, dataExport, 'a module part is missing from storage')
      return
    }
    const bytes = this.archive.build(entries, now)
    const archiveKey = exportArchiveKey(dataExport.userId, dataExport.id)
    await this.storage.write(archiveKey, bytes, 'application/zip')

    // Needed for the mail; asked here (not in the transaction) and not stored — privacy keeps no copy of the address.
    const account = await this.identity.getAccount(dataExport.userId)
    if (!account) {
      await this.fail(message, dataExport, 'the account no longer exists')
      return
    }
    const expiresAt = new Date(now.getTime() + this.policy.exportTtlMs)
    const downloadUrl = this.storage.presignGet(
      archiveKey,
      Math.floor(this.policy.exportTtlMs / 1000),
    )

    await this.inbox.transactional(message.id, this.name, async () => {
      const current = await this.exports.findById(exportId, { lock: true })
      if (current?.status !== 'assembling') return
      current.markReady({ key: archiveKey, size: bytes.byteLength }, expiresAt, now)
      await this.exports.save(current)
      await this.outbox.add([
        dataExportReady(
          {
            exportId,
            userId: current.userId,
            email: account.email,
            locale: account.locale,
            downloadUrl,
            size: bytes.byteLength,
            expiresAt: expiresAt.toISOString(),
          },
          now,
        ),
      ])
    })

    // The parts were only a means; the archive is what stays. A failure here leaves them for the expiry sweep.
    await Promise.all(
      dataExport.props.parts.flatMap((p) => (p.key ? [this.storage.delete(p.key)] : [])),
    ).catch((err) => this.log.warn({ err, exportId }, 'could not remove the parts of an export'))
  }

  private async entriesFor(dataExport: DataExport, now: Date): Promise<ArchiveEntry[] | 'missing'> {
    const entries: ArchiveEntry[] = [
      { path: 'README.txt', data: new TextEncoder().encode(README(now)) },
    ]
    for (const part of dataExport.props.parts) {
      const added = await this.addPart(entries, part)
      if (!added) return 'missing'
    }
    return entries
  }

  private async addPart(entries: ArchiveEntry[], part: ExportPart): Promise<boolean> {
    const json = part.key ? await this.storage.read(part.key) : null
    if (!json) return false
    entries.push({ path: `data/${part.module}.json`, data: json })
    for (const file of part.files) {
      const data = await this.storage.read(file.key)
      // An upload that vanished (deleted meanwhile) is left out, not a reason to fail the whole export.
      if (data) entries.push({ path: `files/${file.path}`, data })
    }
    return true
  }

  private async fail(message: Envelope, dataExport: DataExport, reason: string): Promise<void> {
    const now = this.clock.now()
    await this.inbox.transactional(message.id, this.name, async () => {
      const current = await this.exports.findById(dataExport.id, { lock: true })
      if (!current?.isActive()) return
      current.fail(reason, now)
      await this.exports.save(current)
      await this.outbox.add([
        dataExportFailed({ exportId: current.id, userId: current.userId, reason }, now),
      ])
    })
  }
}
