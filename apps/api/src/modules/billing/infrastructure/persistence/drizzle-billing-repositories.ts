import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import type {
  Balance,
  LedgerEntryRecord,
  LedgerRepository,
  TopUpRepository,
} from '../../domain/billing-repository'
import { TopUp, type TopUpStatus } from '../../domain/top-up'
import { ledgerEntries, topUps, walletBalances } from './schema'

const toTopUp = (row: typeof topUps.$inferSelect) =>
  TopUp.restore({ ...row, status: row.status as TopUpStatus })

export class DrizzleTopUpRepository implements TopUpRepository {
  constructor(private database: Database) {}

  async insert(topUp: TopUp): Promise<void> {
    await this.database.executor.insert(topUps).values(topUp.props)
  }

  async findById(id: string): Promise<TopUp | null> {
    const [row] = await this.database.executor.select().from(topUps).where(eq(topUps.id, id))
    return row ? toTopUp(row) : null
  }

  async findByPaymentIntent(paymentIntentId: string): Promise<TopUp | null> {
    const [row] = await this.database.executor
      .select()
      .from(topUps)
      .where(eq(topUps.paymentIntentId, paymentIntentId))
      // Two deliveries of one event race on this row: the second waits for the first to commit, then sees it settled.
      .for('update')
    return row ? toTopUp(row) : null
  }

  async settle(
    id: string,
    from: readonly TopUpStatus[],
    to: TopUpStatus,
    now: Date,
    failureReason: string | null = null,
  ): Promise<TopUp | null> {
    const [row] = await this.database.executor
      .update(topUps)
      .set({ status: to, failureReason, updatedAt: now })
      .where(and(eq(topUps.id, id), inArray(topUps.status, [...from])))
      .returning()
    return row ? toTopUp(row) : null
  }

  async list(query: { userId: string; before?: string; limit: number }): Promise<TopUp[]> {
    const rows = await this.database.executor
      .select()
      .from(topUps)
      .where(
        and(
          eq(topUps.userId, query.userId),
          query.before ? lt(topUps.id, query.before) : undefined,
        ),
      )
      .orderBy(desc(topUps.id))
      .limit(query.limit)
    return rows.map(toTopUp)
  }
}

export class DrizzleLedgerRepository implements LedgerRepository {
  constructor(private database: Database) {}

  async credit(entry: LedgerEntryRecord & { userId: string }): Promise<number> {
    const db = this.database.executor
    await db.insert(ledgerEntries).values(entry)
    const [row] = await db
      .insert(walletBalances)
      .values({
        userId: entry.userId,
        currency: entry.currency,
        amount: entry.amount,
        updatedAt: entry.createdAt,
      })
      .onConflictDoUpdate({
        target: [walletBalances.userId, walletBalances.currency],
        set: {
          amount: sql`${walletBalances.amount} + ${entry.amount}`,
          updatedAt: entry.createdAt,
        },
      })
      .returning({ amount: walletBalances.amount })
    return row?.amount ?? entry.amount
  }

  async balances(userId: string): Promise<Balance[]> {
    const rows = await this.database.executor
      .select({ currency: walletBalances.currency, amount: walletBalances.amount })
      .from(walletBalances)
      .where(eq(walletBalances.userId, userId))
      .orderBy(asc(walletBalances.currency))
    return rows
  }

  async entries(userId: string): Promise<LedgerEntryRecord[]> {
    const rows = await this.database.executor
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(asc(ledgerEntries.id))
    return rows.map((r) => ({ ...r, type: r.type as 'topup' }))
  }
}
