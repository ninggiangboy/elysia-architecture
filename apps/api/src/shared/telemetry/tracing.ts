import {
  type Attributes,
  type Context,
  context,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { requestContext } from '#/shared/context'

// Without a registered provider every call below is a no-op, so tracing costs nothing when it is not configured.
const tracer = trace.getTracer('elysia-architecture')

export interface TracingOptions {
  serviceName: string
  /** OTLP/HTTP base URL, e.g. http://localhost:4318 (spans go to `<endpoint>/v1/traces`). */
  endpoint: string
}

/** Registers the global tracer provider (W3C propagation, AsyncLocalStorage context). Call once, early. */
export function initTracing({ serviceName, endpoint }: TracingOptions): {
  shutdown(): Promise<void>
} {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      ),
    ],
  })
  provider.register()
  return { shutdown: () => provider.shutdown() }
}

/**
 * The context new spans should hang under. Elysia hooks cannot wrap the handler in a callback, so an HTTP request
 * keeps its span's context in the request context; everywhere else (relay, handlers) it is the active OTel context.
 */
function activeContext(): Context {
  return requestContext.get()?.otel ?? context.active()
}

/** W3C `traceparent` of the current span, to carry across the outbox; undefined when nothing is being traced. */
export function currentTraceparent(): string | undefined {
  const carrier: { traceparent?: string } = {}
  propagation.inject(activeContext(), carrier)
  return carrier.traceparent
}

/** Context to continue from a `traceparent` read off a message or request header (the root context when absent). */
export function contextFromTraceparent(traceparent: string | undefined): Context {
  return traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT
}

export interface SpanOptions {
  kind?: SpanKind
  attributes?: Attributes
  /** Defaults to `activeContext()`. */
  parent?: Context
}

/** Runs `fn` inside a new active span; a throw marks the span as failed and is re-thrown. */
export function withSpan<T>(
  name: string,
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const { kind, attributes, parent = activeContext() } = options
  return tracer.startActiveSpan(name, { kind, attributes }, parent, async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      recordSpanError(span, err)
      throw err
    } finally {
      span.end()
    }
  })
}

export function recordSpanError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : String(err))
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  })
}

/** Starts a span that outlives the callback (an HTTP request); the caller ends it. */
export function startDetachedSpan(
  name: string,
  options: SpanOptions,
): { span: Span; context: Context } {
  const { kind, attributes, parent = context.active() } = options
  const span = tracer.startSpan(name, { kind, attributes }, parent)
  return { span, context: trace.setSpan(parent, span) }
}

export { SpanKind }
