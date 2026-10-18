import { requestContext } from '@kit/context'
import { Elysia } from 'elysia'

const SAFE_ID = /^[\w.-]{1,64}$/

function pick(value: string | null): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined
}

/** Assigns requestId/correlationId to each request (taken from a header or generated) and returns it via `x-request-id`. */
export const requestContextPlugin = new Elysia({ name: 'request-context' }).onRequest(
  ({ request, set }) => {
    const requestId = pick(request.headers.get('x-request-id')) ?? crypto.randomUUID()
    const correlationId = pick(request.headers.get('x-correlation-id')) ?? requestId
    requestContext.enter({ requestId, correlationId })
    set.headers['x-request-id'] = requestId
  },
)
