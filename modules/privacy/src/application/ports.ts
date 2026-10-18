export interface ArchiveEntry {
  /** Path inside the archive, `/`-separated. */
  path: string
  data: Uint8Array
}

export interface ArchiveBuilder {
  build(entries: ArchiveEntry[], now: Date): Uint8Array
}

/** How the two jobs behave — configuration, not business rules. */
export interface PrivacyPolicy {
  /** Modules that contribute a part to an export. */
  exportParticipants: string[]
  /** Modules that must confirm an erasure before the account counts as deleted. */
  deletionParticipants: string[]
  /** Time between asking for the deletion and the erasure starting; the user can cancel in between. */
  deletionGraceMs: number
  /** How long a finished export can be downloaded. */
  exportTtlMs: number
  /** A job that has been quiet this long is re-sent to the modules that have not answered. */
  stallAfterMs: number
  /** Re-sends before the job is given up on (deletion: left for a person; export: failed). */
  maxNudges: number
}

/** The "download now" link the API hands out is short-lived; the mailed one lives as long as the export. */
export const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60
