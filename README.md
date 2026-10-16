# Elysia Architecture

[![CI](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/ci.yml/badge.svg)](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/ci.yml)
[![Security](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/security.yml/badge.svg)](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/security.yml)
[![Code quality](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/quality.yml/badge.svg)](https://github.com/ninggiangboy/elysia-architecture/actions/workflows/quality.yml)

A reference **modular monolith** that is honest about what "production-grade" takes — and built so you can carve any module
out into its own service later **without rewriting domain or application code**.

**Stack:** Elysia · Bun · Drizzle · Postgres · SeaweedFS (S3) · Mailpit — React 19 + Vite + TanStack Router/Query + Tailwind on the front.

It is not a CRUD demo. Passwordless sign-in, rotating sessions, realtime, in-app + Web Push notifications, avatar upload,
rate-limited mail and GDPR export/erasure across modules are all there to exercise the architecture under real distributed-systems pressure (retries, duplicates,
races, N instances).

```
apps/api              backend  (identity · profile · notification · privacy · realtime)
apps/web              React SPA
packages/shared-types constants shared by web ↔ api
docs/architecture.md  the full write-up: principles, flows, trade-offs, module-splitting checklist
```

## What makes it interesting

### 1. Architecture rules are enforced, not suggested
Four layers per module (`presentation → application → domain`, `infrastructure` implements ports). The rules live in
[`.dependency-cruiser.cjs`](apps/api/.dependency-cruiser.cjs) and fail CI when broken:
domain is framework-free, application never imports infrastructure, module A may only import `modules/B/contracts`,
`shared` knows no module, and only the composition root wires concrete adapters. No DI container — the wiring in
`bootstrap/container.ts` is plain, readable code.

### 2. Every module is a future microservice
Own Postgres schema, own migrations (`drizzle_<module>` history table), own outbox/inbox, **no cross-module FKs or JOINs**.
Modules talk only through `contracts/`: plain-DTO interfaces for sync calls and versioned events (`identity.user_registered.v1`)
for async. Splitting a service is a checklist, not a rewrite ([see it](docs/architecture.md#checklist-splitting-a-module-into-a-service)).

### 3. Transactional Outbox + idempotent Inbox
"Write to the DB *and* emit an event" is atomic. The relay claims rows with `FOR UPDATE SKIP LOCKED` + a lease, so any number of
instances can run it without duplicating messages. Consumers dedupe on `(message_id, handler)`, retries use exponential backoff,
and poisoned messages land in a dead-letter queue you can inspect and requeue (`outbox:list` / `outbox:requeue`) — safely, because
the inbox blocks handlers that already finished. The transport is a port (`MessagePublisher`): swap the in-process bus for
NATS/Kafka without touching a handler.

### 4. Stateless and correct with N instances
No sticky sessions, no Redis. Rate limits, throttles and token consumption live in Postgres as single atomic statements
(`UPDATE … WHERE unused AND not expired RETURNING`); optimistic locking via `If-Match` (409 `version_conflict`); one-place-only jobs take
an advisory lock; process roles (`APP_ROLES=api,worker`) let you peel the worker off the same image — it runs the outbox relay and every handler, so heavy ones such as avatar thumbnails (sharp) can sit on their own box — and `APP_PROCESSES=N` runs N processes per container (cluster mode).
`docker compose --profile app up` runs 2 API replicas behind nginx so you can see it work.

### 5. Passwordless auth done properly
- **Magic link** sign-in, consumed atomically, throttled per email and IP.
- **Passkeys** (WebAuthn, usernameless) and **Google / GitHub** sign-in (authorization code + PKCE, account matched only on a provider-verified email).
- **Step-up**: changing the email or a sign-in method needs a recent confirmation — a passkey or an emailed code — on top of a valid session.
- **ES256 JWT** access tokens (15 min) with a `kid` and a public **JWKS** endpoint — other services verify tokens with no shared secret, and keys rotate.
- **Rotating refresh tokens** in an httpOnly cookie, with **reuse detection**: replaying a rotated token outside a 10 s grace window is treated as theft and revokes the whole family — while two tabs refreshing at once don't log you out.
- **Device management**: list signed-in devices, remote logout of one or all others.

### 6. Realtime without Redis
Server-Sent Events fanned out through Postgres `LISTEN/NOTIFY`: use case → outbox → relay → `NOTIFY` → every instance pushes to its own sockets.
Revoke a device from another browser and it signs out **instantly** instead of after the access-token TTL. Best-effort by design
(no replay; clients refetch on reconnect), and the trade-off is documented rather than hidden.

### 7. Notifications: in-app + Web Push, one event
`notification.created.v1` feeds both the SSE bell and **Web Push** (VAPID, service worker) — neither knows about the other.
Subscriptions are bound to the login session that created them (sign out → stop receiving), SSRF-guarded (public `https` endpoints only),
and delivery handles 404/410 cleanup, retries on 429/5xx and skips stale pushes.
A burst of events is stored in full but alerts once: per user, only the first notification in each `PUSH_QUIET_WINDOW_SECONDS` window (default 30) is pushed and toasted, and security alerts always are.

### 8. Mail that survives a provider's rate limits
A token bucket + daily quota in Postgres shared across instances, adaptive back-off when the provider throttles
(SES `454`, Gmail `550 5.4.5`), `RetryLaterError` so the relay defers without burning retry attempts, expired magic links skipped instead
of sent dead, and permanent per-address failures dropped without poisoning the event. Includes an Amazon SES guide.

### 9. Privacy: export and erase, across modules
A multi-step job that runs *through* every module, with no module importing another. **Export:** `privacy` asks, each module writes
its own part to S3 and answers, the parts are zipped, and the link goes out by mail and notification. **Account deletion:** a grace
period the user can cancel in, then a saga by choreography — each module erases its own data and confirms; a silent module is
re-asked (only it), then the job stalls for an operator instead of lying about being done. Progress streams to the browser as
*replayable* realtime events, and the whole thing works unchanged when a module becomes a service (it only needs the two events).

### 10. End-to-end types, zero codegen
The web client is [Eden Treaty](https://elysiajs.com/eden/overview): types are inferred straight from the backend `App` type
(the web app aliases `#/*` to `../api/src/*`). Change a route's schema and the frontend stops compiling.

### 11. Observable and shippable
`x-request-id`/`x-correlation-id` ride AsyncLocalStorage into every pino log line **and** the outbox message headers, so an async
handler's logs trace back to the request that caused them. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and the same chain shows up as one
OpenTelemetry trace in Jaeger — HTTP request → outbox relay → every handler, and onward through events a handler emits. Env-only config, `/health/live` + `/health/ready`, graceful shutdown
(HTTP → relay → pool), PgBouncer-friendly (`DB_PREPARE=false`), OpenAPI/Scalar docs, multi-stage Dockerfiles.
CI runs typecheck, Biome, architecture check, unit + e2e (Postgres/S3/Mailpit, then Playwright), knip, jscpd, gitleaks, Trivy and CodeQL.

## Quick start

Requirements: Bun ≥ 1.4, Docker.

```bash
bun run setup        # .env + install + JWT/VAPID keys + start Postgres/Mailpit/SeaweedFS/Jaeger + migrate
bun run dev          # api :3000 + web :5173
```

Sign in: enter any email at `/login` → open Mailpit → click the link in the mail.

| URL | What it is |
| --- | --- |
| http://localhost:5173 | Web |
| http://localhost:5173/docs | API docs (Scalar) inside the web app; dev builds only |
| http://localhost:3000/api/openapi | OpenAPI spec (only when `NODE_ENV=development`, which `bun run dev` sets) |
| http://localhost:8025 | Mailpit — magic link, welcome and email-confirmation mails |
| http://localhost:16686 | Jaeger — traces (set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `.env` to export them) |
| http://localhost:8333 | SeaweedFS S3 (key `app-access-key` / `app-secret-key`, bucket `avatars`) |
| localhost:5433 | Postgres (`app`/`app`, db `app`) — 5433 to avoid clashing with a local 5432 (`POSTGRES_PORT`) |

Things worth trying:
- **Realtime:** open `/realtime`, then sign in on a second browser and sign it out from the profile page — it drops immediately.
- **Web Push:** enable the toggle in the notification settings (bell → gear), close the tab, trigger an event (e.g. sign in elsewhere).
- **Multi-instance:** `bun run keys:generate && docker compose --profile app up -d --build`, then http://localhost:8080 (2 replicas behind nginx, both running the relay).

## Built-in use cases

- **Sign in with a magic link** — enter an email, get a one-time link, click it. The account is created on first sign-in, which also triggers a welcome mail and the profile.
- **Stay signed in safely** — a short-lived access token plus a rotating refresh cookie; a replayed refresh token is treated as theft and revokes that session.
- **Manage devices** — see every signed-in device (user agent, IP) and sign out one of them or all the others; the affected browser is logged out instantly via realtime.
- **Change email** — the change only takes effect once confirmed from the new inbox.
- **Profile** — view the account and profile in a single call, and edit the profile with an optimistic lock (`If-Match`) so concurrent edits never silently overwrite each other.
- **Avatar upload** — the browser uploads straight to S3 through a presigned URL; the server then validates the file, and the old avatar is cleaned up asynchronously. The profile cover image works the same way. In the browser a picked photo opens in a crop dialog (drag to move, slider/wheel to zoom, framed exactly as it will show) and only the cropped result is uploaded.
- **In-app notifications** — a bell whose badge counts what is new since you last opened it (separate from unread) and opens the inbox in a popover, cursor-paged history and mark-as-read (one or all) that stays in sync across the user's open devices.
- **Web Push** — opt in per browser to receive the same notifications as system notifications while the app is closed, without a buzz per event when many arrive at once.
- **Export your data** — one zip with what every module holds about you (profile, avatar, notifications, sign-in methods…), mailed as a link, with live progress. Asking for it needs a recent confirmation.
- **Delete your account** — scheduled, with a grace period to cancel; then every module erases and confirms, and you get a last mail. Try both at `/privacy`.
- **Live events** — a Server-Sent Events stream for session and notification updates, plus a test endpoint to fire your own event.
- **Transactional mail** — magic-link, welcome and email-confirmation mails sent through the outbox, with provider-aware rate limiting and retries.
- **Token verification for other services** — a public JWKS endpoint (`/.well-known/jwks.json`).
- **Health checks** — liveness and readiness probes (`/health/live`, `/health/ready`).

The full endpoint list is in the OpenAPI/Scalar docs (see the URLs above).

## Testing

```bash
bun run test                 # unit: domain + use cases against in-memory fakes (no I/O)
bun run check:arch           # architecture boundary rules (dependency-cruiser)
bun run typecheck && bun run lint
bun run test:e2e             # needs infra: real buildApp + Postgres/S3/Mailpit, then Playwright
bun run quality:unused       # knip — dead code and unused dependencies
bun run quality:dup          # jscpd — copy/paste detection
```

Because use cases depend on ports, the unit suite runs the whole application layer against in-memory fakes in milliseconds;
the e2e suite then proves the real adapters (including outbox retries, mail throttling, SSE and Web Push) against real infrastructure.

## Common commands

| Command | What it does |
| --- | --- |
| `bun run --filter @app/api db:generate` | Generate migrations per module (after editing `schema.ts`) |
| `bun run --filter @app/api db:migrate` | Run migrations per module (each has its own `drizzle_<module>` history table) |
| `bun run --filter @app/api outbox:list` / `outbox:requeue` | List / requeue events that ended up in the dead-letter queue |
| `bun run --filter @app/api keys:generate` | Generate JWT (ES256) and VAPID keys into `.env` (never overwrites an existing pair) |
| `bun run infra:down` | Stop the containers (add `-v` to `docker compose down` to delete data) |

## Deliberate trade-offs

Nothing here is free, and the docs say so: access tokens outlive logout by up to 15 minutes (no Redis denylist), the magic-link
throttle can let a few requests slip through under a race, realtime is best-effort (only events that opt in, such as sign-out, are replayed after a reconnect; the rest are refetched), and one shared pool/transaction means you must
review cross-module transactions before splitting. See [Deliberate trade-offs](docs/architecture.md#deliberate-trade-offs).

---

📖 **Go deeper:** [docs/architecture.md](docs/architecture.md) — layers and rules, distributed-ready principles, every major flow, mail rate limiting, and the checklist for splitting a module into a service.
