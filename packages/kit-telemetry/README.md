# @kit/telemetry

## Purpose

The pino logger (with the request context mixed in) and OpenTelemetry tracing set-up: an OTLP exporter, `withSpan`, and the trace-context helpers the outbox uses.

## Install

```bash
bun add @kit/telemetry
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `Logger`. Implements the `Log` port of `@kit/core` with pino.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP/HTTP endpoint of a collector (Jaeger: http://localhost:4318). Unset = tracing off. |
| `OTEL_SERVICE_NAME` | `elysia-architecture-api` | Service name on the spans. |
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { createLogger, initTracing } from '@kit/telemetry'

const logger = createLogger(config.core.LOG_LEVEL)
const tracing = config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT
  ? initTracing({ serviceName: 'my-api', endpoint: config.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT })
  : null
await tracing?.shutdown() // on exit, so the last spans are flushed
```

## Guarantees

Tracing is off unless an endpoint is set; spans of a request, the relay batch and the handlers are linked through the message headers.

## Limits

OTLP over HTTP only.

## Related

[Trace context across async hops](../../docs/patterns/trace-context-across-async-hops.md)
