import type { Clock, IdGenerator, Log } from '@kit/core'
import type { Database } from '@kit/db'
import type { Mailer } from '@kit/mail'
import type { ObjectStorage } from '@kit/storage'

/**
 * What the host app hands every module's `install`: the shared building blocks and the whole configuration. A module's install
 * narrows `Config` to the slices it reads (`ModuleHost<{ billing: BillingConfig }>`), so it states what it needs and the host
 * stays free to hold more. Modules it depends on come in as `modules`, and replacements for its adapters (tests) as `overrides`.
 */
export interface ModuleHost<Config = unknown> {
  config: Config
  logger: Log
  clock: Clock
  ids: IdGenerator
  /** One pool and one transaction context for all modules; modules differ only by Postgres schema. */
  database: Database
  storage: ObjectStorage
  mailer: Mailer
}
