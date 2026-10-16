import type { AccountDeletion } from '../domain/account-deletion'
import type { DataExport } from '../domain/data-export'

export interface ExportView {
  id: string
  status: DataExport['status']
  requestedAt: string
  readyAt: string | null
  expiresAt: string | null
  /** Bytes; `null` until the archive exists. */
  size: number | null
  progress: { done: number; total: number }
  /** Modules that have delivered their part. */
  modules: { module: string; done: boolean }[]
}

export const toExportView = (e: DataExport): ExportView => ({
  id: e.id,
  status: e.status,
  requestedAt: e.props.requestedAt.toISOString(),
  readyAt: e.props.readyAt?.toISOString() ?? null,
  expiresAt: e.props.expiresAt?.toISOString() ?? null,
  size: e.props.archiveSize,
  progress: e.progress(),
  modules: e.props.parts.map((p) => ({ module: p.module, done: p.done })),
})

export interface DeletionView {
  id: string
  /** `stalled` is shown as `running`: to the user it is the same thing — the erasure is under way. */
  status: 'scheduled' | 'running'
  requestedAt: string
  /** End of the grace period; cancelling is possible until then. */
  scheduledFor: string
  startedAt: string | null
  progress: { done: number; total: number }
  modules: { module: string; done: boolean }[]
}

export const toDeletionView = (d: AccountDeletion): DeletionView => ({
  id: d.id,
  status: d.status === 'scheduled' ? 'scheduled' : 'running',
  requestedAt: d.props.requestedAt.toISOString(),
  scheduledFor: d.props.scheduledFor.toISOString(),
  startedAt: d.props.startedAt?.toISOString() ?? null,
  progress: d.progress(),
  modules: d.props.steps.map((s) => ({ module: s.module, done: s.confirmed })),
})
