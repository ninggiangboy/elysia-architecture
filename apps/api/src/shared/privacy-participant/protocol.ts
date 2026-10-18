/**
 * The participation protocol of the privacy jobs: what a module must consume and emit to take part in a data export or
 * an account erasure. It is owned here, not by the `privacy` module, so a participant depends on a stable protocol and
 * not on a business module — which is what lets `privacy` be left out of an app.
 *
 *   privacy.data_export_requested.v1     ─► <module>.data_exported.v1
 *   privacy.account_erasure_requested.v1 ─► <module>.user_data_erased.v1
 *
 * The event type strings are written to outbox rows and inbox keys: never change them in place (add a `.v2`).
 */
export const PrivacyProtocol = {
  DataExportRequested: 'privacy.data_export_requested.v1',
  AccountErasureRequested: 'privacy.account_erasure_requested.v1',
} as const

/** The events a participant answers with. `<module>` is the name privacy lists it under. */
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
