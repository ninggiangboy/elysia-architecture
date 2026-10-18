import type { Clock, Log, UnitOfWork } from '@kit/core'
import type { OutboxWriter } from '#/shared/messaging'
import type { ObjectStorage } from '#/shared/storage'
import type { AccountDeletionRepository, DataExportRepository } from '../domain/repositories'
import { exportFolder, exportPartsPrefix } from './keys'
import type { PrivacyPolicy } from './ports'
import {
  accountDeletionStalled,
  dataExportFailed,
  dataExportRequested,
  erasureRequestFor,
} from './privacy-events'

/** Rows handled per run and per kind: the next run takes the rest. */
const BATCH = 25

export interface JobsReport {
  started: number
  nudged: number
  stalled: number
  failed: number
  expired: number
}

/**
 * The part of both jobs that is driven by time, not by an event: nothing in the system "happens" when a grace period
 * ends or when a module stays silent, so something has to look. Run it on a timer, from any number of instances —
 * rows are claimed with `FOR UPDATE SKIP LOCKED`, so an instance never repeats another's work.
 */
export class PrivacyJobs {
  constructor(
    private exports: DataExportRepository,
    private deletions: AccountDeletionRepository,
    private storage: ObjectStorage,
    private policy: PrivacyPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
    private log: Log,
  ) {}

  async runOnce(): Promise<JobsReport> {
    const report: JobsReport = { started: 0, nudged: 0, stalled: 0, failed: 0, expired: 0 }
    const now = this.clock.now()
    await this.uow.run(async () => {
      await this.startDueDeletions(now, report)
      await this.nudgeDeletions(now, report)
      await this.nudgeExports(now, report)
    })
    // Outside the claim transaction: deleting objects is slow and idempotent, and must not hold row locks.
    await this.expireExports(now, report)
    return report
  }

  /** Grace period over → ask every module to erase. */
  private async startDueDeletions(now: Date, report: JobsReport): Promise<void> {
    for (const deletion of await this.deletions.claimDue(now, BATCH)) {
      deletion.start(this.policy.deletionParticipants, now)
      await this.deletions.save(deletion)
      await this.outbox.add([erasureRequestFor(deletion, now)])
      report.started += 1
      this.log.info({ deletionId: deletion.id }, 'account erasure started')
    }
  }

  /** A module that stays silent gets the request again; after `maxNudges` a person has to look. */
  private async nudgeDeletions(now: Date, report: JobsReport): Promise<void> {
    const quietBefore = new Date(now.getTime() - this.policy.stallAfterMs)
    for (const deletion of await this.deletions.claimStalled(quietBefore, BATCH)) {
      if (deletion.props.nudges >= this.policy.maxNudges) {
        deletion.stall(now)
        await this.deletions.save(deletion)
        await this.outbox.add([
          accountDeletionStalled(
            {
              deletionId: deletion.id,
              userId: deletion.userId,
              pending: deletion.pendingModules(),
            },
            now,
          ),
        ])
        report.stalled += 1
        this.log.error(
          { deletionId: deletion.id, pending: deletion.pendingModules() },
          'account erasure stalled: modules did not confirm, needs attention',
        )
        continue
      }
      deletion.nudged(now)
      await this.deletions.save(deletion)
      await this.outbox.add([erasureRequestFor(deletion, now)])
      report.nudged += 1
      this.log.warn(
        {
          deletionId: deletion.id,
          pending: deletion.pendingModules(),
          attempt: deletion.props.nudges,
        },
        'account erasure re-sent to the modules that have not confirmed',
      )
    }
  }

  /** Same idea for exports — but an export nobody finished is simply abandoned: the user can ask again. */
  private async nudgeExports(now: Date, report: JobsReport): Promise<void> {
    const quietBefore = new Date(now.getTime() - this.policy.stallAfterMs)
    for (const dataExport of await this.exports.claimStalled(quietBefore, BATCH)) {
      if (dataExport.props.nudges >= this.policy.maxNudges) {
        dataExport.fail('modules did not deliver their data in time', now)
        await this.exports.save(dataExport)
        await this.outbox.add([
          dataExportFailed(
            {
              exportId: dataExport.id,
              userId: dataExport.userId,
              reason: dataExport.props.failureReason ?? 'unknown',
            },
            now,
          ),
        ])
        report.failed += 1
        this.log.error(
          { exportId: dataExport.id, pending: dataExport.pendingModules() },
          'data export failed: modules did not deliver',
        )
        continue
      }
      // Still `assembling` means the archive step is what is stuck, and that retries by itself through the relay.
      if (dataExport.status === 'collecting') {
        dataExport.nudged(now)
        await this.exports.save(dataExport)
        await this.outbox.add([
          dataExportRequested(
            {
              exportId: dataExport.id,
              userId: dataExport.userId,
              uploadPrefix: exportPartsPrefix(dataExport.userId, dataExport.id),
              modules: dataExport.pendingModules(),
            },
            now,
          ),
        ])
        report.nudged += 1
      } else {
        dataExport.nudged(now)
        await this.exports.save(dataExport)
      }
    }
  }

  /** A ready export is kept `exportTtl`, then its folder (archive and any leftovers) is deleted. */
  private async expireExports(now: Date, report: JobsReport): Promise<void> {
    const due = await this.uow.run(async () => {
      const claimed = await this.exports.claimExpired(now, BATCH)
      for (const dataExport of claimed) {
        // Marked first, deleted after: if the delete fails the next run does not see it again, so the failure is logged
        // and the leftovers are removed with the rest of the user's folder when the account is erased.
        dataExport.expire(now)
        await this.exports.save(dataExport)
      }
      return claimed
    })
    for (const dataExport of due) {
      try {
        await this.storage.deletePrefix(exportFolder(dataExport.userId, dataExport.id))
        report.expired += 1
      } catch (err) {
        this.log.error({ err, exportId: dataExport.id }, 'could not delete an expired export')
      }
    }
  }
}
