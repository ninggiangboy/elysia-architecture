import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@opentelemetry/api'

export interface RequestContext {
  requestId: string
  correlationId: string
  userId?: string
  /** OTel context holding the request's span (set by the tracing plugin; new spans and outbox writes hang under it). */
  otel?: Context
}

const storage = new AsyncLocalStorage<RequestContext>()

export const requestContext = {
  get: () => storage.getStore(),
  run: <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn),
  /** For use in HTTP framework hooks (where the handler cannot be wrapped in a callback). */
  enter: (ctx: RequestContext) => storage.enterWith(ctx),
}
