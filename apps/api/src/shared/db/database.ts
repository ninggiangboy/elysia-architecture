import { AsyncLocalStorage } from 'node:async_hooks'
import type { UnitOfWork } from '@kit/core'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// biome-ignore lint/suspicious/noExplicitAny: the schema generic does not matter — only the query builder is used
export type DrizzleDb = PostgresJsDatabase<any>
/** An open Database or transaction — same query builder interface. */
export type Executor = Pick<DrizzleDb, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface DatabaseOptions {
  url: string
  poolMax: number
  prepare: boolean
}

/**
 * ONE connection pool + transaction context shared by all modules. Modules differ only by Postgres schema
 * (a module's tables live in its own schema, with no cross-module FK), so one transaction can span several modules.
 */
export class Database implements UnitOfWork {
  private readonly txStorage = new AsyncLocalStorage<Executor>()
  readonly client: postgres.Sql
  readonly db: DrizzleDb

  constructor(options: DatabaseOptions) {
    this.client = postgres(options.url, {
      max: options.poolMax,
      prepare: options.prepare,
      onnotice: () => {},
    })
    this.db = drizzle(this.client)
  }

  /** The current transaction if inside `run`, otherwise the pool. */
  get executor(): Executor {
    return this.txStorage.getStore() ?? this.db
  }

  get inTransaction(): boolean {
    return this.txStorage.getStore() !== undefined
  }

  /** When nested, joins the outer transaction (no savepoint). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn()
    return this.db.transaction((tx) => this.txStorage.run(tx as unknown as Executor, fn))
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`)
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 })
  }
}

/** True if the driver error (drizzle wraps it in `cause`) carries one of these SQLSTATE codes. */
export function isPgError(err: unknown, ...codes: string[]): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 3 && current; depth++) {
    const code = (current as { code?: string }).code
    if (code && codes.includes(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Unique violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return isPgError(err, '23505')
}
