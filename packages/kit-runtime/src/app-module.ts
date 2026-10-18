import type { ConfigSlice } from '@kit/config'
import type { IntegrationEventHandler, OutboxSource } from '@kit/messaging'
import type { PrivacyParticipation } from '@kit/privacy-participant'

/** A section of the API docs: the `tags` of the module's routes, described once. */
export interface ApiDocTag {
  name: string
  description: string
}

/** Timers behind a module's background work. The container starts and stops them as a group (worker role, maintenance mode). */
export interface ModuleJobs {
  /** Starts the timers. Called when the process has the worker role and is not in maintenance. Idempotent. */
  start(): void
  /** Stops the timers and waits for the running pass to finish. Idempotent. */
  stop(): Promise<void>
}

/**
 * What the composition root needs from every business module. Each factory returns this plus its own API
 * (`api`, `verifier`, `reconcile`, `prune`…), so a new module is one more entry in the container's list.
 */
export interface AppModule<Name extends string = string, Routes = unknown> {
  readonly name: Name
  /** An Elysia instance. `app.ts` mounts it with a static `.use()` so Eden can infer the client types. */
  readonly routes?: Routes
  /** The API doc sections the module's routes are filed under. */
  readonly docs?: readonly ApiDocTag[]
  readonly handlers?: readonly IntegrationEventHandler[]
  readonly outbox?: OutboxSource
  readonly jobs?: ModuleJobs
  readonly privacy?: PrivacyParticipation
  /** Releases live resources (SSE connections, LISTEN). Called BEFORE the HTTP server is stopped. */
  close?(): Promise<void>
}

/**
 * What a host app needs to know about a module without building it: where its migrations and schema are, its outbox table
 * and its configuration. Static data, so CLI scripts (`db:migrate`, `outbox:list`) and drizzle-kit can read it without
 * pulling in the container. Every module package exports one as `@mod/<name>/manifest`.
 */
export interface ModuleManifest {
  readonly name: string
  /** The module's folder: it holds its own `drizzle.config.ts`. */
  readonly dir: string
  /** Absolute path of the folder with the module's generated migrations. */
  readonly migrations: string
  /** Absolute path of the Drizzle schema file drizzle-kit reads. */
  readonly schemaFile: string
  /** The module's outbox table, or `null` when it emits no events. */
  readonly outbox: OutboxSource['table'] | null
  /** The module's configuration slice, read under `config.<name>`; `undefined` when it has no variables of its own. */
  readonly config: ConfigSlice | undefined
}
