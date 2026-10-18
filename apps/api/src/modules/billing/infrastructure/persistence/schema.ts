import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { inboxTable, outboxTable } from '#/shared/messaging'
import type { DocumentLine, Party } from '../../domain/document'

export const billingSchema = pgSchema('billing')

export const outbox = outboxTable(billingSchema)
export const inbox = inboxTable(billingSchema)

/**
 * `user_id` references the identity module's user by value — NO cross-module FK. It is nullable because erasing an
 * account keeps the financial record and only drops the person from it. Ids are UUIDv7, so id order = creation order.
 * Amounts are integers in the currency's smallest unit.
 */
export const topUps = billingSchema.table(
  'top_ups',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id'),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    paymentIntentId: text('payment_intent_id').notNull(),
    failureReason: text('failure_reason'),
    /** The client's `Idempotency-Key` for starting this top-up; `null` when it sent none. */
    idempotencyKey: text('idempotency_key'),
    /** When the reconciliation job last asked the provider about this payment; `null` = never. */
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('top_ups_payment_intent_idx').on(t.paymentIntentId),
    // Starting the same top-up twice (a double click, a retry) finds the first one instead of making a second.
    uniqueIndex('top_ups_idempotency_idx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('top_ups_user_idx').on(t.userId, t.id.desc()),
    // What the reconciliation job scans: payments that can still be completed.
    index('top_ups_unsettled_idx').on(t.createdAt).where(sql`${t.status} in ('pending', 'failed')`),
    check('top_ups_amount_positive', sql`${t.amount} > 0`),
    check(
      'top_ups_status_known',
      sql`${t.status} in ('pending', 'succeeded', 'failed', 'canceled')`,
    ),
  ],
)

/** Append-only: one row per movement of money. The balance is this table summed, kept in `wallet_balances` for reads. */
export const ledgerEntries = billingSchema.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id'),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    topUpId: uuid('top_up_id').notNull(),
    /** The provider's id of the refund or dispute behind an adjustment; `null` for the top-up itself. */
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('ledger_entries_user_idx').on(t.userId, t.id),
    // A top-up is credited once; a refund or a dispute is booked once however often its webhook is delivered.
    uniqueIndex('ledger_entries_top_up_idx').on(t.topUpId, t.type).where(sql`${t.type} = 'topup'`),
    uniqueIndex('ledger_entries_reference_idx')
      .on(t.type, t.reference)
      .where(sql`${t.reference} is not null`),
    check('ledger_entries_amount_nonzero', sql`${t.amount} <> 0`),
    check(
      'ledger_entries_type_known',
      sql`${t.type} in ('topup', 'refund', 'chargeback', 'chargeback_reversal')`,
    ),
  ],
)

export const walletBalances = billingSchema.table(
  'wallet_balances',
  {
    userId: uuid('user_id').notNull(),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.currency] })],
)

/** What the provider's webhooks said, one row per event: for finding out why a payment was or was not credited. */
export const paymentEvents = billingSchema.table(
  'payment_events',
  {
    /** The provider's event id (`evt_…`). */
    id: text('id').primaryKey(),
    paymentIntentId: text('payment_intent_id').notNull(),
    /** What was done with it: `applied`, `ignored` or `deferred`. */
    result: text('result').notNull(),
    /** How many times the provider delivered it. */
    deliveries: integer('deliveries').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('payment_events_intent_idx').on(t.paymentIntentId)],
)

/**
 * Payments that need a person: money that moved without reaching a wallet (or a wallet that went below zero). Nothing
 * is fixed automatically; a row is the alert. One per (payment, kind), however often the webhook repeats.
 */
export const paymentAnomalies = billingSchema.table(
  'payment_anomalies',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    paymentIntentId: text('payment_intent_id').notNull(),
    topUpId: uuid('top_up_id'),
    eventId: text('event_id').notNull(),
    detail: text('detail').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('payment_anomalies_kind_idx').on(t.paymentIntentId, t.kind)],
)

/**
 * Invoices, receipts and credit notes: issued once, never edited (only an invoice's or a credit note's `status` moves).
 * Seller, buyer and lines are snapshots of the moment of issuing. `user_id` is nullable for the same reason as in
 * `top_ups`: erasing an account keeps the document and drops the person from it.
 */
export const documents = billingSchema.table(
  'documents',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    status: text('status').notNull(),
    topUpId: uuid('top_up_id').notNull(),
    userId: uuid('user_id'),
    currency: text('currency').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** The invoice a receipt or a credit note belongs to. */
    invoiceId: uuid('invoice_id'),
    /** The provider's refund or dispute id behind a credit note. */
    reference: text('reference'),
    seller: jsonb('seller').$type<Party>().notNull(),
    buyer: jsonb('buyer').$type<Party>().notNull(),
    lines: jsonb('lines').$type<DocumentLine[]>().notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('documents_number_idx').on(t.number),
    // A top-up has one invoice and one receipt, however often its webhook is delivered.
    uniqueIndex('documents_top_up_idx')
      .on(t.topUpId, t.kind)
      .where(sql`${t.kind} in ('invoice', 'receipt')`),
    uniqueIndex('documents_reference_idx')
      .on(t.kind, t.reference)
      .where(sql`${t.reference} is not null`),
    index('documents_user_idx').on(t.userId, t.id.desc()),
    check('documents_amount_positive', sql`${t.amount} > 0`),
    check('documents_kind_known', sql`${t.kind} in ('invoice', 'receipt', 'credit_note')`),
    check('documents_status_known', sql`${t.status} in ('open', 'paid', 'void', 'issued')`),
  ],
)

/** The last number handed out per kind and year. Row-locked while a document is stored, so numbers have no gaps. */
export const documentCounters = billingSchema.table(
  'document_counters',
  {
    kind: text('kind').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
)
