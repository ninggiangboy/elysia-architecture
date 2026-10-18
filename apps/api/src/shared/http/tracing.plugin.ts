import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { Elysia } from 'elysia'
import { requestContext } from '#/shared/context'
import {
  contextFromTraceparent,
  recordSpanError,
  SpanKind,
  startDetachedSpan,
} from '#/shared/telemetry'

const spans = new WeakMap<Request, Span>()
const errors = new WeakMap<Request, unknown>()

/** Health probes would drown every real trace. */
const isProbe = (pathname: string) => pathname.includes('/health/')

/**
 * One SERVER span per request, continuing the caller's `traceparent` when present. Must be mounted after
 * `requestContextPlugin`: the span's context goes into the request context so the outbox writer can carry it on.
 */
export const tracingPlugin = new Elysia({ name: 'tracing' })
  .onRequest(({ request }) => {
    const { pathname } = new URL(request.url)
    if (isProbe(pathname)) return
    const { span, context } = startDetachedSpan(`${request.method} ${pathname}`, {
      kind: SpanKind.SERVER,
      parent: contextFromTraceparent(request.headers.get('traceparent') ?? undefined),
      attributes: { 'http.request.method': request.method, 'url.path': pathname },
    })
    const ctx = requestContext.get()
    if (ctx) {
      ctx.otel = context
      span.setAttributes({
        'app.request_id': ctx.requestId,
        'app.correlation_id': ctx.correlationId,
      })
    }
    spans.set(request, span)
  })
  .onError({ as: 'global' }, ({ request, error }) => {
    // Kept until the response status is known: a 4xx DomainError is not a failure of this service.
    if (spans.has(request)) errors.set(request, error)
  })
  .onAfterResponse({ as: 'global' }, ({ request, route, set }) => {
    const span = spans.get(request)
    if (!span) return
    spans.delete(request)
    const status = typeof set.status === 'number' ? set.status : 200
    // Low-cardinality name (the route pattern, not the concrete URL) once the router has matched.
    if (route) span.updateName(`${request.method} ${route}`)
    span.setAttributes({
      'http.response.status_code': status,
      ...(route && { 'http.route': route }),
    })
    // 4xx is the client's mistake, not the server's: only 5xx fails the span.
    if (status >= 500) {
      if (errors.has(request)) recordSpanError(span, errors.get(request))
      else span.setStatus({ code: SpanStatusCode.ERROR })
    }
    span.end()
  })
