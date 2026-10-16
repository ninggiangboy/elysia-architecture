/**
 * Integration events of the privacy module. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 *
 * The two jobs are choreographies. Privacy asks, every participating module answers on its own:
 *
 *   data_export_requested ─► <module>.data_exported ─► … ─► data_export_ready      (or data_export_failed)
 *   account_erasure_requested ─► <module>.user_data_erased ─► … ─► account_deleted
 *
 * A participant's answer is named by convention (see `participantEvents`), so a new module — or one that has been split
 * out into a service — joins by consuming the request and emitting its answer; privacy only needs its name in the list.
 */
export const PrivacyEvents = {
  DataExportRequested: 'privacy.data_export_requested.v1',
  DataExportProgressed: 'privacy.data_export_progressed.v1',
  DataExportReady: 'privacy.data_export_ready.v1',
  DataExportFailed: 'privacy.data_export_failed.v1',
  AccountDeletionScheduled: 'privacy.account_deletion_scheduled.v1',
  AccountDeletionCancelled: 'privacy.account_deletion_cancelled.v1',
  AccountErasureRequested: 'privacy.account_erasure_requested.v1',
  AccountErasureProgressed: 'privacy.account_erasure_progressed.v1',
  AccountDeletionStalled: 'privacy.account_deletion_stalled.v1',
  AccountDeleted: 'privacy.account_deleted.v1',
} as const

/** The events a participant module answers with. `<module>` is the name privacy lists it under. */
export const participantEvents = (module: string) =>
  ({
    dataExported: `${module}.data_exported.v1`,
    userDataErased: `${module}.user_data_erased.v1`,
  }) as const

export interface DataExportRequestedPayload {
  exportId: string
  userId: string
  /** Bucket prefix every participant writes its part under: `<uploadPrefix><module>.json`. */
  uploadPrefix: string
  /** Modules that still owe a part; on a re-sent request only those need to answer. */
  modules: string[]
  requestedAt: string
}

/** What a participant answers with once its part is in the bucket (`<module>.data_exported.v1`). */
export interface ModuleDataExportedPayload {
  exportId: string
  userId: string
  module: string
  /** Where the module's JSON is. */
  key: string
  size: number
  /** Extra objects to ship in the archive (path inside the archive → key in the bucket). */
  files: { path: string; key: string }[]
  exportedAt: string
}

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

export interface AccountErasureRequestedPayload {
  deletionId: string
  userId: string
  /** Modules that still owe a confirmation; on a re-sent request only those need to answer. */
  modules: string[]
  /** 0 for the first request, then 1, 2… for each re-send. */
  attempt: number
  requestedAt: string
}

/** What a participant answers with once its data is gone (`<module>.user_data_erased.v1`). */
export interface ModuleUserDataErasedPayload {
  deletionId: string
  userId: string
  module: string
  erasedAt: string
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
