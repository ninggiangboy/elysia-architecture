import { PrivacyProtocol } from '@kit/privacy-participant'

// The participation protocol lives in shared/privacy-participant: a participant depends on it, not on this module.
// Re-exported here so privacy's own code and its consumers keep one place to import from.
export type {
  AccountErasureRequestedPayload,
  DataExportRequestedPayload,
  ModuleDataExportedPayload,
  ModuleUserDataErasedPayload,
} from '@kit/privacy-participant'
export { participantEvents } from '@kit/privacy-participant'

/**
 * Integration events of the privacy module. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 *
 * The two jobs are choreographies. Privacy asks, every participating module answers on its own:
 *
 *   data_export_requested ─► <module>.data_exported ─► … ─► data_export_ready      (or data_export_failed)
 *   account_erasure_requested ─► <module>.user_data_erased ─► … ─► account_deleted
 *
 * A participant's answer is named by convention (see `participantEvents` in shared/privacy-participant), so a new module — or one that has been split
 * out into a service — joins by consuming the request and emitting its answer; privacy only needs its name in the list.
 */
export const PrivacyEvents = {
  DataExportRequested: PrivacyProtocol.DataExportRequested,
  DataExportProgressed: 'privacy.data_export_progressed.v1',
  DataExportReady: 'privacy.data_export_ready.v1',
  DataExportFailed: 'privacy.data_export_failed.v1',
  AccountDeletionScheduled: 'privacy.account_deletion_scheduled.v1',
  AccountDeletionCancelled: 'privacy.account_deletion_cancelled.v1',
  AccountErasureRequested: PrivacyProtocol.AccountErasureRequested,
  AccountErasureProgressed: 'privacy.account_erasure_progressed.v1',
  AccountDeletionStalled: 'privacy.account_deletion_stalled.v1',
  AccountDeleted: 'privacy.account_deleted.v1',
} as const

export interface DataExportProgressedPayload {
  exportId: string
  userId: string
  /** The module whose part just arrived. */
  module: string
  done: number
  total: number
  at: string
}

export interface DataExportReadyPayload {
  exportId: string
  userId: string
  email: string
  /** The account's language when the archive was built, for the mail. Absent on older messages = default. */
  locale?: string
  /** Presigned link, valid until `expiresAt`. Lives in the outbox until it is cleaned up. */
  downloadUrl: string
  size: number
  expiresAt: string
}

export interface DataExportFailedPayload {
  exportId: string
  userId: string
  reason: string
  failedAt: string
}

export interface AccountDeletionScheduledPayload {
  deletionId: string
  userId: string
  email: string
  /** The account's language, for the mail. Absent on older messages = default. */
  locale?: string
  /** End of the grace period: the account is erased from then on, unless the user cancels before. */
  scheduledFor: string
  requestedAt: string
}

export interface AccountDeletionCancelledPayload {
  deletionId: string
  userId: string
  email: string
  locale?: string
  cancelledAt: string
}

export interface AccountErasureProgressedPayload {
  deletionId: string
  userId: string
  module: string
  done: number
  total: number
  at: string
}

/** Some participants never answered, even after the job was re-sent: needs a person. */
export interface AccountDeletionStalledPayload {
  deletionId: string
  userId: string
  pending: string[]
  stalledAt: string
}

export interface AccountDeletedPayload {
  deletionId: string
  userId: string
  /** For the one goodbye mail; scrubbed from privacy's own tables as soon as this is emitted. */
  email: string
  /** The account's language when the deletion was scheduled (the account itself is gone by now). */
  locale?: string
  deletedAt: string
}
