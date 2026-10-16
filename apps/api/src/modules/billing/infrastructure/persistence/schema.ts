import {
  bigint,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { inboxTable, outboxTable } from '#/shared/infrastructure/outbox/tables'

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('top_ups_payment_intent_idx').on(t.paymentIntentId),
    index('top_ups_user_idx').on(t.userId, t.id.desc()),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('ledger_entries_user_idx').on(t.userId, t.id),
    uniqueIndex('ledger_entries_top_up_idx').on(t.topUpId, t.type),
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
