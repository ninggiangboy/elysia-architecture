import type { IntegrationEventHandler } from '#/shared/application/ports'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import type { PrivacyParticipation } from '#/shared/privacy-participant'

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
  readonly handlers?: readonly IntegrationEventHandler[]
  readonly outbox?: OutboxSource
  readonly jobs?: ModuleJobs
  readonly privacy?: PrivacyParticipation
  /** Releases live resources (SSE connections, LISTEN). Called BEFORE the HTTP server is stopped. */
  close?(): Promise<void>
}
