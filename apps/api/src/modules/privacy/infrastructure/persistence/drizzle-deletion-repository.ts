import { DEFAULT_LOCALE, matchLocale } from '@app/shared-types'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { ConflictError } from '#/shared/core'
import { type Database, isUniqueViolation } from '#/shared/db'
import { AccountDeletion, type DeletionStatus } from '../../domain/account-deletion'
import type { AccountDeletionRepository } from '../../domain/repositories'
import { accountDeletions, deletionSteps } from './schema'

type DeletionRow = typeof accountDeletions.$inferSelect

const ACTIVE = ['scheduled', 'running', 'stalled']

export class DrizzleAccountDeletionRepository implements AccountDeletionRepository {
  constructor(private database: Database) {}

  async add(deletion: AccountDeletion): Promise<void> {
    try {
      await this.database.executor.insert(accountDeletions).values(toRow(deletion))
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError(
          'deletion_already_scheduled',
          'This account is already scheduled for deletion',
        )
      throw err
    }
  }

  async findById(id: string, options: { lock?: boolean } = {}): Promise<AccountDeletion | null> {
    const query = this.database.executor
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.id, id))
      .limit(1)
    const [row] = await (options.lock ? query.for('update') : query)
    return row ? (await this.hydrate([row]))[0]! : null
  }

  async findActiveByUser(
    userId: string,
    options: { lock?: boolean } = {},
  ): Promise<AccountDeletion | null> {
    const query = this.database.executor
      .select()
      .from(accountDeletions)
      .where(and(eq(accountDeletions.userId, userId), inArray(accountDeletions.status, ACTIVE)))
      .limit(1)
    const [row] = await (options.lock ? query.for('update') : query)
    return row ? (await this.hydrate([row]))[0]! : null
  }

  async save(deletion: AccountDeletion): Promise<void> {
    const { id: _id, ...row } = toRow(deletion)
    await this.database.executor
      .update(accountDeletions)
      .set(row)
      .where(eq(accountDeletions.id, deletion.id))
    const steps = deletion.props.steps
    if (steps.length === 0) return
    await this.database.executor
      .insert(deletionSteps)
      .values(
        steps.map((s) => ({
          deletionId: deletion.id,
          module: s.module,
          confirmed: s.confirmed,
          confirmedAt: s.confirmedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [deletionSteps.deletionId, deletionSteps.module],
        set: { confirmed: sql`excluded.confirmed`, confirmedAt: sql`excluded.confirmed_at` },
      })
  }

  async claimDue(now: Date, limit: number): Promise<AccountDeletion[]> {
    const rows = await this.database.executor
      .select()
      .from(accountDeletions)
      .where(and(eq(accountDeletions.status, 'scheduled'), lte(accountDeletions.scheduledFor, now)))
      .orderBy(accountDeletions.scheduledFor)
      .limit(limit)
      .for('update', { skipLocked: true })
    return this.hydrate(rows)
  }

  async claimStalled(quietBefore: Date, limit: number): Promise<AccountDeletion[]> {
    const rows = await this.database.executor
      .select()
      .from(accountDeletions)
      .where(
        and(eq(accountDeletions.status, 'running'), lte(accountDeletions.updatedAt, quietBefore)),
      )
      .orderBy(accountDeletions.updatedAt)
      .limit(limit)
      .for('update', { skipLocked: true })
    return this.hydrate(rows)
  }

  private async hydrate(rows: DeletionRow[]): Promise<AccountDeletion[]> {
    if (rows.length === 0) return []
    const steps = await this.database.executor
      .select()
      .from(deletionSteps)
      .where(
        inArray(
          deletionSteps.deletionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(deletionSteps.module)
    return rows.map((r) =>
      AccountDeletion.restore({
        id: r.id,
        userId: r.userId,
        email: r.email,
        locale: matchLocale(r.locale) ?? DEFAULT_LOCALE,
        status: r.status as DeletionStatus,
        requestedAt: r.requestedAt,
        scheduledFor: r.scheduledFor,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        updatedAt: r.updatedAt,
        nudges: r.nudges,
        steps: steps
          .filter((s) => s.deletionId === r.id)
          .map((s) => ({ module: s.module, confirmed: s.confirmed, confirmedAt: s.confirmedAt })),
      }),
    )
  }
}

function toRow(d: AccountDeletion): typeof accountDeletions.$inferInsert {
  const p = d.props
  return {
    id: p.id,
    userId: p.userId,
    email: p.email,
    locale: p.locale,
    status: p.status,
    requestedAt: p.requestedAt,
    scheduledFor: p.scheduledFor,
    startedAt: p.startedAt,
    completedAt: p.completedAt,
    cancelledAt: p.cancelledAt,
    updatedAt: p.updatedAt,
    nudges: p.nudges,
  }
}
