# @kit/web-core

## Purpose

The browser-side plumbing every client of this API needs: an observable store, the auth store, single-flight session refresh, a fetch that sends the token and the language and retries once after a refresh, outage and maintenance detection, an SSE client with replay, `unwrap`/`ApiError`, a query client and runtime config.

## Install

```bash
bun add @kit/web-core
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

No ports. `@kit/web-core/react` adds `useStore`.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { createAuthFetch, createAuthStore, createSession, createOutageDetector } from '@kit/web-core'

const store = createAuthStore<{ id: string; email: string }>()
const session = createSession({ store, refreshUrl: () => `${origin}/api/auth/refresh` })
const outage = createOutageDetector({ healthUrl: () => `${origin}/api/health/ready` })
const authFetch = createAuthFetch({ store, refresh: session.refreshSession, locale: () => 'en',
  isAuthEndpoint: (url) => String(url).includes('/api/auth/'), onResponse: outage.watchResponse })
```

## Guarantees

Many requests hitting 401 together refresh once (the refresh token rotates); a refresh that loses a race with another tab is retried once.

## Limits

Assumes the API's auth endpoints and error shape (`@kit/http`).

## Related

[Single-flight token refresh](../../docs/patterns/single-flight-token-refresh.md) · [Outage detection](../../docs/patterns/outage-detection-and-offline-fallback.md)
