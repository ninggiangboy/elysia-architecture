import { Database } from '@kit/db'
import { sql } from 'drizzle-orm'
import { loadAppConfig } from '#/bootstrap/config'

/** The configuration the dev stack runs with (`bun run infra:up`): Postgres, SeaweedFS, Mailpit. */
export const config = loadAppConfig({ ...process.env, LOG_LEVEL: 'silent' })

export const database = new Database({
  url: config.db.DATABASE_URL,
  poolMax: 5,
  prepare: config.db.DB_PREPARE,
})

/** Tables shaped like a module's outbox and inbox, in a schema of their own, so the suites never touch a real module's rows. */
export async function ensureContractTables() {
  await database.db.execute(sql`create schema if not exists contract_test`)
  await database.db.execute(sql`
    create table if not exists contract_test.inbox (
      message_id uuid not null,
      handler text not null,
      processed_at timestamptz not null default now(),
      primary key (message_id, handler)
    )`)
  await database.db.execute(sql`
    create table if not exists contract_test.outbox_messages (
      id uuid primary key,
      type text not null,
      aggregate_id text not null,
      payload jsonb not null,
      headers jsonb not null,
      occurred_at timestamptz not null,
      attempts integer not null default 0,
      next_attempt_at timestamptz not null default now(),
      locked_until timestamptz,
      published_at timestamptz,
      dead_at timestamptz,
      last_error text
    )`)
}

export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
