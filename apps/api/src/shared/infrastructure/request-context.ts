import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  correlationId: string
  userId?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export const requestContext = {
  get: () => storage.getStore(),
  run: <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn),
  /** For use in HTTP framework hooks (where the handler cannot be wrapped in a callback). */
  enter: (ctx: RequestContext) => storage.enterWith(ctx),
}
