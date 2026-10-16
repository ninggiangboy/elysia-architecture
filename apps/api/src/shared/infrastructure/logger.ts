import pino from 'pino'
import { requestContext } from './request-context'

export type Logger = pino.Logger

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Mọi dòng log tự gắn requestId/correlationId của ngữ cảnh hiện tại.
    mixin: () => {
      const ctx = requestContext.get()
      return ctx ? { requestId: ctx.requestId, correlationId: ctx.correlationId } : {}
    },
  })
}
