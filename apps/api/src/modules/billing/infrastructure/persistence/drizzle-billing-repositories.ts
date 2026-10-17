import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/infrastructure/db/database'
import type {
  AnomalyKind,
  Balance,
  DocumentRepository,
  LedgerEntryRecord,
  LedgerEntryType,
  LedgerRepository,
  PaymentAuditRepository,
  TopUpRepository,
} from '../../domain/billing-repository'
import { BillingDocument, type DocumentKind, type DocumentStatus } from '../../domain/document'
import { TopUp, type TopUpStatus } from '../../domain/top-up'
import {
  documentCounters,
  documents,
  ledgerEntries,
  paymentAnomalies,
  paymentEvents,
  topUps,
  walletBalances,
} from './schema'

const toDocument = (row: typeof documents.$inferSelect) =>
  BillingDocument.restore({
    ...row,
    kind: row.kind as DocumentKind,
    status: row.status as DocumentStatus,
  })

const toTopUp = (row: typeof topUps.$inferSelect) =>
  TopUp.restore({ ...row, status: row.status as TopUpStatus })

export class DrizzleTopUpRepository implements TopUpRepository {
  constructor(private database: Database) {}

  async insert(topUp: TopUp): Promise<boolean> {
    const rows = await this.database.executor
      .insert(topUps)
      .values(topUp.props)
      // A retry collides on the idempotency key — and, when two of them race, on the payment too (the provider hands
      // both the same one). Either way the first stored wins and this reports `false`.
      .onConflictDoNothing()
      .returning({ id: topUps.id })
    return rows.length > 0
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<TopUp | null> {
    const [row] = await this.database.executor
      .select()
      .from(topUps)
      .where(and(eq(topUps.userId, userId), eq(topUps.idempotencyKey, key)))
    return row ? toTopUp(row) : null
  }

  async claimForReconciliation(query: {
    createdBefore: Date
    createdAfter: Date
    checkedBefore: Date
    limit: number
    now: Date
  }): Promise<TopUp[]> {
    const db = this.database.executor
    const due = db
      .select({ id: topUps.id })
      .from(topUps)
      .where(
        and(
          inArray(topUps.status, ['pending', 'failed']),
          lt(topUps.createdAt, query.createdBefore),
          gt(topUps.createdAt, query.createdAfter),
          or(isNull(topUps.reconciledAt), lt(topUps.reconciledAt, query.checkedBefore)),
        ),
      )
      .orderBy(asc(topUps.createdAt))
      .limit(query.limit)
      // Another instance's pass skips what this one is claiming instead of waiting for it.
      .for('update', { skipLocked: true })
    const rows = await db
      .update(topUps)
      .set({ reconciledAt: query.now })
      .where(inArray(topUps.id, due))
      .returning()
    return rows.map(toTopUp)
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

  async post(entry: LedgerEntryRecord & { userId: string }): Promise<number | null> {
    const db = this.database.executor
    const booked = await db
      .insert(ledgerEntries)
      .values(entry)
      // Already booked (the unique indexes on the top-up, or on the refund / dispute): the balance must not move twice.
      .onConflictDoNothing()
      .returning({ id: ledgerEntries.id })
    if (booked.length === 0) return null
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

  async hasReference(type: LedgerEntryType, reference: string): Promise<boolean> {
    const [row] = await this.database.executor
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.type, type), eq(ledgerEntries.reference, reference)))
    return row !== undefined
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
    return rows.map((r) => ({ ...r, type: r.type as LedgerEntryType }))
  }
}

export class DrizzlePaymentAuditRepository implements PaymentAuditRepository {
  constructor(private database: Database) {}

  async recordEvent(event: {
    id: string
    paymentIntentId: string
    result: string
    now: Date
  }): Promise<void> {
    await this.database.executor
      .insert(paymentEvents)
      .values({
        id: event.id,
        paymentIntentId: event.paymentIntentId,
        result: event.result,
        firstSeenAt: event.now,
        lastSeenAt: event.now,
      })
      .onConflictDoUpdate({
        target: paymentEvents.id,
        set: {
          result: event.result,
          deliveries: sql`${paymentEvents.deliveries} + 1`,
          lastSeenAt: event.now,
        },
      })
  }

  async recordAnomaly(anomaly: {
    id: string
    kind: AnomalyKind
    paymentIntentId: string
    topUpId: string | null
    eventId: string
    detail: string
    now: Date
  }): Promise<void> {
    await this.database.executor
      .insert(paymentAnomalies)
      .values({
        id: anomaly.id,
        kind: anomaly.kind,
        paymentIntentId: anomaly.paymentIntentId,
        topUpId: anomaly.topUpId,
        eventId: anomaly.eventId,
        detail: anomaly.detail,
        createdAt: anomaly.now,
      })
      .onConflictDoNothing()
  }
}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private database: Database) {}

  async nextSequence(kind: DocumentKind, year: number): Promise<number> {
    const [row] = await this.database.executor
      .insert(documentCounters)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [documentCounters.kind, documentCounters.year],
        set: { last: sql`${documentCounters.last} + 1` },
      })
      .returning({ last: documentCounters.last })
    if (!row) throw new Error('the document counter returned nothing')
    return row.last
  }

  async insert(document: BillingDocument): Promise<void> {
    await this.database.executor.insert(documents).values(document.props)
  }

  async findById(id: string): Promise<BillingDocument | null> {
    const [row] = await this.database.executor.select().from(documents).where(eq(documents.id, id))
    return row ? toDocument(row) : null
  }

  async findForTopUp(
    topUpId: string,
    kind: 'invoice' | 'receipt',
  ): Promise<BillingDocument | null> {
    const [row] = await this.database.executor
      .select()
      .from(documents)
      .where(and(eq(documents.topUpId, topUpId), eq(documents.kind, kind)))
    return row ? toDocument(row) : null
  }

  async findByReference(kind: 'credit_note', reference: string): Promise<BillingDocument | null> {
    const [row] = await this.database.executor
      .select()
      .from(documents)
      .where(and(eq(documents.kind, kind), eq(documents.reference, reference)))
    return row ? toDocument(row) : null
  }

  async settleInvoice(
    topUpId: string,
    from: readonly DocumentStatus[],
    to: DocumentStatus,
    now: Date,
  ): Promise<BillingDocument | null> {
    const [row] = await this.database.executor
      .update(documents)
      .set({ status: to, settledAt: now })
      .where(
        and(
          eq(documents.topUpId, topUpId),
          eq(documents.kind, 'invoice'),
          inArray(documents.status, [...from]),
        ),
      )
      .returning()
    return row ? toDocument(row) : null
  }

  async voidCreditNote(reference: string, now: Date): Promise<BillingDocument | null> {
    const [row] = await this.database.executor
      .update(documents)
      .set({ status: 'void', settledAt: now })
      .where(
        and(
          eq(documents.kind, 'credit_note'),
          eq(documents.reference, reference),
          eq(documents.status, 'issued'),
        ),
      )
      .returning()
    return row ? toDocument(row) : null
  }

  async list(query: {
    userId: string
    kind?: DocumentKind
    topUpId?: string
    before?: string
    limit: number
  }): Promise<BillingDocument[]> {
    const rows = await this.database.executor
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, query.userId),
          query.kind ? eq(documents.kind, query.kind) : undefined,
          query.topUpId ? eq(documents.topUpId, query.topUpId) : undefined,
          query.before ? lt(documents.id, query.before) : undefined,
        ),
      )
      .orderBy(desc(documents.id))
      .limit(query.limit)
    return rows.map(toDocument)
  }
}
