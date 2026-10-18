# @kit/context

## Purpose

The request context (`requestId`, `correlationId`, `userId`) in an `AsyncLocalStorage`, so logs, the outbox and traces can name the request they belong to without passing it around.

## Install

```bash
bun add @kit/context
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

No ports.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { requestContext } from '@kit/context'

requestContext.run({ requestId, correlationId }, async () => {
  // anything awaited in here, however deep, sees the same context
  requestContext.get()?.correlationId
})
```

## Guarantees

The outbox writer copies the context into the message headers, and the relay restores it for the handlers, so a correlation id survives the hop through the database.

## Limits

Per process: it does not travel over HTTP by itself (the tracing plugin propagates `traceparent`).

## Related

[Trace context across async hops](../../docs/patterns/trace-context-across-async-hops.md)
