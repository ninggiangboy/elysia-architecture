import pino from 'pino'
import { requestContext } from './request-context'

export type Logger = pino.Logger

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Every log line is automatically tagged with the requestId/correlationId of the current context.
    mixin: () => {
      const ctx = requestContext.get()
      return ctx ? { requestId: ctx.requestId, correlationId: ctx.correlationId } : {}
    },
  })
}
