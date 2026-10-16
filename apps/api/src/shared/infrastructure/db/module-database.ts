import { AsyncLocalStorage } from 'node:async_hooks'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { UnitOfWork } from '#/shared/application/ports'

// biome-ignore lint/suspicious/noExplicitAny: schema generic không quan trọng — chỉ dùng query builder
export type Database = PostgresJsDatabase<any>
/** Database hoặc transaction đang mở — cùng interface query builder. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface DatabaseOptions {
  url: string
  poolMax: number
  prepare: boolean
}

/**
 * Kết nối + ngữ cảnh transaction của MỘT module. Mỗi module có instance riêng nên repository
 * của module A không thể vô tình chạy trong transaction của module B — đúng ranh giới để tách DB sau này.
 */
export class ModuleDatabase implements UnitOfWork {
  private readonly txStorage = new AsyncLocalStorage<Executor>()
  readonly client: postgres.Sql
  readonly db: Database

  constructor(
    readonly name: string,
    options: DatabaseOptions,
  ) {
    this.client = postgres(options.url, {
      max: options.poolMax,
      prepare: options.prepare,
      onnotice: () => {},
    })
    this.db = drizzle(this.client)
  }

  /** Transaction hiện tại nếu đang trong `run`, ngược lại là pool. */
  get executor(): Executor {
    return this.txStorage.getStore() ?? this.db
  }

  get inTransaction(): boolean {
    return this.txStorage.getStore() !== undefined
  }

  /** Lồng nhau thì tham gia transaction ngoài (không savepoint). */
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

/** Unique violation (23505) — drizzle bọc lỗi driver trong `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 3 && current; depth++) {
    if ((current as { code?: string }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
