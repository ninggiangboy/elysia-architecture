import type { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator, UnitOfWork } from '@kit/core'
import { ConflictError, NotFoundError } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import type { ObjectStorage } from '@kit/storage'
import type { IdentityApi } from '@mod/identity/contracts'
import { DataExport } from '../../domain/data-export'
import type { AccountDeletionRepository, DataExportRepository } from '../../domain/repositories'
import { exportPartsPrefix } from '../keys'
import { DOWNLOAD_LINK_TTL_SECONDS, type PrivacyPolicy } from '../ports'
import { dataExportRequested } from '../privacy-events'
import { type ExportView, toExportView } from '../views'

/** How many past exports the list shows. */
const LIST_LIMIT = 10

/**
 * Starts an export: one row for the job, one event that asks every participating module for its part.
 * Needs a recent confirmation — the archive is everything the service knows about the user.
 */
export class RequestDataExport {
  constructor(
    private exports: DataExportRepository,
    private deletions: AccountDeletionRepository,
    private identity: IdentityApi,
    private policy: PrivacyPolicy,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private ids: IdGenerator,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; authTime: number | undefined }): Promise<ExportView> {
    this.stepUp.assertFresh(cmd.authTime)
    // Outside the transaction: a sync call to another module must never hold one open.
    const account = await this.identity.getAccount(cmd.userId)
    if (!account) throw new NotFoundError('user_not_found', 'Account not found')

    const now = this.clock.now()
    return this.uow.run(async () => {
      const deletion = await this.deletions.findActiveByUser(cmd.userId)
      if (deletion && deletion.status !== 'scheduled')
        throw new ConflictError('account_being_deleted', 'The account is being erased')
      const dataExport = DataExport.request({
        id: this.ids.next(),
        userId: cmd.userId,
        modules: this.policy.exportParticipants,
        now,
      })
      await this.exports.add(dataExport)
      await this.outbox.add([
        dataExportRequested(
          {
            exportId: dataExport.id,
            userId: cmd.userId,
            uploadPrefix: exportPartsPrefix(cmd.userId, dataExport.id),
            modules: this.policy.exportParticipants,
          },
          now,
        ),
      ])
      return toExportView(dataExport)
    })
  }
}

export class ListDataExports {
  constructor(private exports: DataExportRepository) {}

  async execute(query: { userId: string }): Promise<ExportView[]> {
    return (await this.exports.listByUser(query.userId, LIST_LIMIT)).map(toExportView)
  }
}

export class GetDataExport {
  constructor(private exports: DataExportRepository) {}

  async execute(query: { userId: string; exportId: string }): Promise<ExportView> {
    // Scoped by user: someone else's export is a 404, never a 403 that confirms it exists.
    const dataExport = await this.exports.findByUserAndId(query.userId, query.exportId)
    if (!dataExport) throw new NotFoundError('export_not_found', 'Export not found')
    return toExportView(dataExport)
  }
}

/** A fresh, short-lived link to a ready archive. Also needs a recent confirmation. */
export class GetExportDownload {
  constructor(
    private exports: DataExportRepository,
    private storage: ObjectStorage,
    private stepUp: StepUpPolicy,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    exportId: string
    authTime: number | undefined
  }): Promise<{ url: string; expiresAt: string }> {
    this.stepUp.assertFresh(cmd.authTime)
    const dataExport = await this.exports.findByUserAndId(cmd.userId, cmd.exportId)
    if (!dataExport) throw new NotFoundError('export_not_found', 'Export not found')
    const now = this.clock.now()
    if (!dataExport.isDownloadable(now) || !dataExport.props.archiveKey)
      throw new ConflictError('export_not_ready', 'The export is not available for download')
    const linkExpiry = new Date(now.getTime() + DOWNLOAD_LINK_TTL_SECONDS * 1000)
    return {
      url: this.storage.presignGet(dataExport.props.archiveKey, DOWNLOAD_LINK_TTL_SECONDS),
      expiresAt: linkExpiry.toISOString(),
    }
  }
}
