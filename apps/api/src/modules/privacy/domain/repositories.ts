import type { AccountDeletion } from './account-deletion'
import type { DataExport } from './data-export'

export interface DataExportRepository {
  /** Inserts the request with its parts. A user with an export in progress → ConflictError('export_in_progress'). */
  add(dataExport: DataExport): Promise<void>
  /**
   * Loads the aggregate. With `lock` the row is locked until the transaction ends, so parts arriving at the same time are
   * applied one after the other and exactly one of them sees the export complete.
   */
  findById(id: string, options?: { lock?: boolean }): Promise<DataExport | null>
  findByUserAndId(userId: string, id: string): Promise<DataExport | null>
  /** Newest first. */
  listByUser(userId: string, limit: number): Promise<DataExport[]>
  save(dataExport: DataExport): Promise<void>
  /** In progress and quiet since before `quietBefore`, oldest first. Locked, skipping rows another instance holds. */
  claimStalled(quietBefore: Date, limit: number): Promise<DataExport[]>
  /** Ready and past their expiry. Locked, skipping rows another instance holds. */
  claimExpired(now: Date, limit: number): Promise<DataExport[]>
}

export interface AccountDeletionRepository {
  /** A user with a deletion in play → ConflictError('deletion_already_scheduled'). */
  add(deletion: AccountDeletion): Promise<void>
  findById(id: string, options?: { lock?: boolean }): Promise<AccountDeletion | null>
  /** The user's deletion that is scheduled, running or stalled, if any. */
  findActiveByUser(userId: string, options?: { lock?: boolean }): Promise<AccountDeletion | null>
  save(deletion: AccountDeletion): Promise<void>
  /** Scheduled with a grace period that has ended. Locked, skipping rows another instance holds. */
  claimDue(now: Date, limit: number): Promise<AccountDeletion[]>
  /** Running and quiet since before `quietBefore`. Locked, skipping rows another instance holds. */
  claimStalled(quietBefore: Date, limit: number): Promise<AccountDeletion[]>
}
