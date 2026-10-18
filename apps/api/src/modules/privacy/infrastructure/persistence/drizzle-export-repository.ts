import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { ConflictError } from '#/shared/core'
import { type Database, isUniqueViolation } from '#/shared/db'
import { DataExport, type ExportStatus } from '../../domain/data-export'
import type { DataExportRepository } from '../../domain/repositories'
import { exportParts, exportRequests } from './schema'

type RequestRow = typeof exportRequests.$inferSelect

export class DrizzleDataExportRepository implements DataExportRepository {
  constructor(private database: Database) {}

  async add(dataExport: DataExport): Promise<void> {
    try {
      await this.database.executor.insert(exportRequests).values(toRow(dataExport))
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('export_in_progress', 'An export is already being prepared')
      throw err
    }
    await this.writeParts(dataExport)
  }

  async findById(id: string, options: { lock?: boolean } = {}): Promise<DataExport | null> {
    const query = this.database.executor
      .select()
      .from(exportRequests)
      .where(eq(exportRequests.id, id))
      .limit(1)
    const [row] = await (options.lock ? query.for('update') : query)
    return row ? (await this.hydrate([row]))[0]! : null
  }

  async findByUserAndId(userId: string, id: string): Promise<DataExport | null> {
    const [row] = await this.database.executor
      .select()
      .from(exportRequests)
      .where(and(eq(exportRequests.id, id), eq(exportRequests.userId, userId)))
      .limit(1)
    return row ? (await this.hydrate([row]))[0]! : null
  }

  async listByUser(userId: string, limit: number): Promise<DataExport[]> {
    const rows = await this.database.executor
      .select()
      .from(exportRequests)
      .where(eq(exportRequests.userId, userId))
      .orderBy(desc(exportRequests.requestedAt), desc(exportRequests.id))
      .limit(limit)
    return this.hydrate(rows)
  }

  async save(dataExport: DataExport): Promise<void> {
    const { id: _id, ...row } = toRow(dataExport)
    await this.database.executor
      .update(exportRequests)
      .set(row)
      .where(eq(exportRequests.id, dataExport.id))
    await this.writeParts(dataExport)
  }

  async claimStalled(quietBefore: Date, limit: number): Promise<DataExport[]> {
    const rows = await this.database.executor
      .select()
      .from(exportRequests)
      .where(
        and(
          inArray(exportRequests.status, ['collecting', 'assembling']),
          lte(exportRequests.updatedAt, quietBefore),
        ),
      )
      .orderBy(exportRequests.updatedAt)
      .limit(limit)
      .for('update', { skipLocked: true })
    return this.hydrate(rows)
  }

  async claimExpired(now: Date, limit: number): Promise<DataExport[]> {
    const rows = await this.database.executor
      .select()
      .from(exportRequests)
      .where(and(eq(exportRequests.status, 'ready'), lte(exportRequests.expiresAt, now)))
      .orderBy(exportRequests.expiresAt)
      .limit(limit)
      .for('update', { skipLocked: true })
    return this.hydrate(rows)
  }

  private async writeParts(dataExport: DataExport): Promise<void> {
    const parts = dataExport.props.parts
    if (parts.length === 0) return
    await this.database.executor
      .insert(exportParts)
      .values(
        parts.map((p) => ({
          exportId: dataExport.id,
          module: p.module,
          done: p.done,
          key: p.key,
          size: p.size,
          files: p.files,
          completedAt: p.completedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [exportParts.exportId, exportParts.module],
        set: {
          done: sql`excluded.done`,
          key: sql`excluded.key`,
          size: sql`excluded.size`,
          files: sql`excluded.files`,
          completedAt: sql`excluded.completed_at`,
        },
      })
  }

  private async hydrate(rows: RequestRow[]): Promise<DataExport[]> {
    if (rows.length === 0) return []
    const parts = await this.database.executor
      .select()
      .from(exportParts)
      .where(
        inArray(
          exportParts.exportId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(exportParts.module)
    return rows.map((r) =>
      DataExport.restore({
        id: r.id,
        userId: r.userId,
        status: r.status as ExportStatus,
        requestedAt: r.requestedAt,
        updatedAt: r.updatedAt,
        readyAt: r.readyAt,
        expiresAt: r.expiresAt,
        archiveKey: r.archiveKey,
        archiveSize: r.archiveSize,
        failureReason: r.failureReason,
        nudges: r.nudges,
        parts: parts
          .filter((p) => p.exportId === r.id)
          .map((p) => ({
            module: p.module,
            done: p.done,
            key: p.key,
            size: p.size,
            files: p.files,
            completedAt: p.completedAt,
          })),
      }),
    )
  }
}

function toRow(e: DataExport): typeof exportRequests.$inferInsert {
  const p = e.props
  return {
    id: p.id,
    userId: p.userId,
    status: p.status,
    requestedAt: p.requestedAt,
    updatedAt: p.updatedAt,
    readyAt: p.readyAt,
    expiresAt: p.expiresAt,
    archiveKey: p.archiveKey,
    archiveSize: p.archiveSize,
    failureReason: p.failureReason,
    nudges: p.nudges,
  }
}
