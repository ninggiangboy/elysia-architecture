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
  /** Dùng trong hook của HTTP framework (không bọc được handler bằng callback). */
  enter: (ctx: RequestContext) => storage.enterWith(ctx),
}
