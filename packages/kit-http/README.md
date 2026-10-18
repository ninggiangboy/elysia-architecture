# @kit/http

## Purpose

The Elysia plugins every API needs: error handler (one error envelope), request context, tracing, maintenance mode, OpenAPI helpers, client IP and user agent.

## Install

```bash
bun add @kit/http
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

No ports. Elysia is a peer dependency; this is the only kit package (with `auth`, `runtime` and `storage/http`) that imports it.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { API_PREFIX, errorHandlerPlugin, maintenancePlugin, requestContextPlugin, tracingPlugin } from '@kit/http'

new Elysia({ prefix: API_PREFIX })
  .use(requestContextPlugin)
  .use(tracingPlugin)
  .use(errorHandlerPlugin(logger))
  .use(maintenancePlugin(maintenance))
```

## Guarantees

Every error answers `{ error: { code, message, requestId, details? } }`; domain errors map to statuses by `kind`; a request in maintenance mode answers `503 maintenance` before reaching a route.

## Limits

Plugins are named, so Elysia de-duplicates them; the app and the packages must resolve the same `elysia` copy.

## Related

[Maintenance mode](../../docs/patterns/maintenance-mode-soft-deploy.md)
