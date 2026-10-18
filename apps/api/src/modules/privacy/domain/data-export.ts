import { DomainError } from '#/shared/core'

const conflict = (code: string, message: string) => new DomainError(code, message, 'conflict')

/**
 * collecting ─► assembling ─► ready ─► expired
 *     └────────────┴──────► failed
 */
export type ExportStatus = 'collecting' | 'assembling' | 'ready' | 'failed' | 'expired'

const ACTIVE_EXPORT_STATUSES: readonly ExportStatus[] = ['collecting', 'assembling']

export interface ExportFileRef {
  path: string
  key: string
}

/** One module's share of an export. */
export interface ExportPart {
  module: string
  done: boolean
  key: string | null
  size: number
  files: ExportFileRef[]
  completedAt: Date | null
}

export interface DataExportProps {
  id: string
  userId: string
  status: ExportStatus
  requestedAt: Date
  /** Last time anything happened — a part arrived, the job was re-sent. A job quiet for too long is stalled. */
  updatedAt: Date
  readyAt: Date | null
  expiresAt: Date | null
  archiveKey: string | null
  archiveSize: number | null
  failureReason: string | null
  /** How many times the request was re-sent to the modules that had not answered. */
  nudges: number
  parts: ExportPart[]
}

export type PartOutcome = 'recorded' | 'duplicate' | 'ignored'

/**
 * A user's request for a copy of their data. Each participating module contributes one part; when the last one is in the
 * archive is assembled. The aggregate only tracks the job — the data itself lives in the bucket, never in privacy's tables.
 */
export class DataExport {
  private constructor(readonly props: DataExportProps) {}

  static request(input: { id: string; userId: string; modules: string[]; now: Date }): DataExport {
    return new DataExport({
      id: input.id,
      userId: input.userId,
      status: 'collecting',
      requestedAt: input.now,
      updatedAt: input.now,
      readyAt: null,
      expiresAt: null,
      archiveKey: null,
      archiveSize: null,
      failureReason: null,
      nudges: 0,
      parts: input.modules.map((module) => ({
        module,
        done: false,
        key: null,
        size: 0,
        files: [],
        completedAt: null,
      })),
    })
  }

  static restore(props: DataExportProps): DataExport {
    return new DataExport(props)
  }

  get id() {
    return this.props.id
  }
  get userId() {
    return this.props.userId
  }
  get status() {
    return this.props.status
  }

  isActive(): boolean {
    return ACTIVE_EXPORT_STATUSES.includes(this.props.status)
  }

  progress(): { done: number; total: number } {
    return {
      done: this.props.parts.filter((p) => p.done).length,
      total: this.props.parts.length,
    }
  }

  pendingModules(): string[] {
    return this.props.parts.filter((p) => !p.done).map((p) => p.module)
  }

  isCollected(): boolean {
    return this.props.parts.every((p) => p.done)
  }

  /** A module's part is in. Answers that arrive twice, late, or from a stranger change nothing. */
  recordPart(
    answer: { module: string; key: string; size: number; files: ExportFileRef[] },
    now: Date,
  ): PartOutcome {
    const part = this.props.parts.find((p) => p.module === answer.module)
    if (!part || this.props.status !== 'collecting') return 'ignored'
    if (part.done) return 'duplicate'
    part.done = true
    part.key = answer.key
    part.size = answer.size
    part.files = answer.files
    part.completedAt = now
    this.props.updatedAt = now
    return 'recorded'
  }

  /** Every part is in: from here the archive is built. */
  beginAssembly(now: Date): void {
    if (this.props.status !== 'collecting' || !this.isCollected())
      throw conflict('export_not_collected', 'Not every module has delivered its part')
    this.props.status = 'assembling'
    this.props.updatedAt = now
  }

  markReady(archive: { key: string; size: number }, expiresAt: Date, now: Date): void {
    if (this.props.status !== 'assembling')
      throw conflict('export_not_assembling', 'The export is not being assembled')
    this.props.status = 'ready'
    this.props.archiveKey = archive.key
    this.props.archiveSize = archive.size
    this.props.readyAt = now
    this.props.expiresAt = expiresAt
    this.props.updatedAt = now
  }

  fail(reason: string, now: Date): void {
    if (!this.isActive()) throw conflict('export_finished', 'The export is already over')
    this.props.status = 'failed'
    this.props.failureReason = reason
    this.props.updatedAt = now
  }

  expire(now: Date): void {
    if (this.props.status !== 'ready') throw conflict('export_not_ready', 'Not ready')
    this.props.status = 'expired'
    this.props.updatedAt = now
  }

  /** The request was re-sent to the modules that had not answered; restarts the quiet period. */
  nudged(now: Date): void {
    this.props.nudges += 1
    this.props.updatedAt = now
  }

  /** Quiet for at least `quietMs` while still in progress. */
  isStalled(now: Date, quietMs: number): boolean {
    return this.isActive() && now.getTime() - this.props.updatedAt.getTime() >= quietMs
  }

  isDownloadable(now: Date): boolean {
    return (
      this.props.status === 'ready' &&
      this.props.expiresAt !== null &&
      this.props.expiresAt.getTime() > now.getTime()
    )
  }
}
