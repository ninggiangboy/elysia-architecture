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
apps/api              the composition root: installs the modules, mounts their routes, runs them
apps/web              React SPA (a feature registry on @kit/ui and @kit/web-core)
packages/kit-*        infrastructure packages (@kit/*): core, config, db, messaging, http, auth, mail, storage, runtime, testing, i18n, ui, web-core…
modules/*             business modules (@mod/*): identity · profile · notification · privacy · billing · realtime
examples/starter      a minimal API (identity + profile) that needs only Postgres: the template for a new project
templates/module      what `bun run gen:module` copies
packages/shared-types the product's languages and a few constants shared by web ↔ api
docs/architecture.md  the map: goals, modules, big picture, reading guide
docs/architecture/    how the system works, topic by topic (messaging, auth, realtime, privacy, billing…)
docs/guides/          adopt the kit in a new project · use one package alone
docs/adr/             why it is split this way
docs/patterns/        reusable techniques as standalone recipes
```

## What makes it interesting

### 1. Architecture rules are enforced, not suggested
Four layers per module (`presentation → application → domain`, `infrastructure` implements ports). The rules live in three
dependency-cruiser configs ([kit](.dependency-cruiser.packages.cjs), [modules](.dependency-cruiser.modules.cjs),
[app](apps/api/.dependency-cruiser.cjs)) and fail CI when broken: domain is framework-free, application never imports
infrastructure, module A may only import what module B exports, a kit package imports only the packages its graph allows, and
only the composition root wires concrete adapters. No DI container — the wiring in `bootstrap/container.ts` is plain,
readable code: build the host, `install` each module in order, hand them to `createRuntime`.

### 2. Every module is a future microservice
Own Postgres schema, own migrations (history in schema `drizzle_<module>`), own outbox/inbox, **no cross-module FKs or JOINs**.
Modules talk only through `contracts/`: plain-DTO interfaces for sync calls and versioned events (`identity.user_registered.v1`)
for async, and each module is a package whose `exports` map makes anything else unreachable. Splitting a service is a checklist, not a rewrite ([see it](docs/architecture/01-modules-and-boundaries.md#extracting-a-module-into-a-service)).

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
Revoke a device from another browser and it signs out **instantly** instead of after the access-token TTL. Best-effort by design:
most events are refetched on reconnect, and only the few that opt in (sign-out, privacy job steps, a credited top-up) are replayed
from a short buffer via `Last-Event-ID`. The trade-off is documented rather than hidden.

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

### 10. Money that is credited exactly once
Topping up a wallet with Stripe: the browser pays with our own card form, calling Stripe's API directly (no Stripe.js), and only the signed webhook moves money. The top-up settles
with a conditional update in the same transaction as the ledger entry and the balance, so a redelivered or reordered webhook can neither
pay twice nor take money back. Wallets hold one balance per currency (integer minor units), and erasing an account anonymises the
financial records instead of deleting them.

### 11. End-to-end types, zero codegen
The web client is [Eden Treaty](https://elysiajs.com/eden/overview): types are inferred straight from the backend `App` type
(`import type { App } from '@app/api'`). Change a route's schema and the frontend stops compiling.

### 12. Observable and shippable
`x-request-id`/`x-correlation-id` ride AsyncLocalStorage into every pino log line **and** the outbox message headers, so an async
handler's logs trace back to the request that caused them. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and the same chain shows up as one
OpenTelemetry trace in Jaeger — HTTP request → outbox relay → every handler, and onward through events a handler emits. Env-only config, `/health/live` + `/health/ready`, graceful shutdown
(HTTP → relay → pool), PgBouncer-friendly (`DB_PREPARE=false`), OpenAPI/Scalar docs, multi-stage Dockerfiles.
CI runs typecheck, Biome, architecture check, unit + e2e (Postgres/S3/Mailpit, then Playwright), knip, jscpd, gitleaks, Trivy and CodeQL.

### 13. A kit, not just an app
The infrastructure (`@kit/*`) and the business modules (`@mod/*`) are versioned packages with tests, an exports map, a README and
(for modules) a manifest and an `install(host)`. A new project starts from [`examples/starter`](examples/starter) (identity and profile,
no S3, SMTP, Stripe or VAPID), adds what it needs with `bun run kit:add billing`, and customises through a closed list of extension
points (adapters, config, integrations, wording, event handlers) — anything else is an explicit eject. `bun run gen:module <name>`
creates a module that works out of the box; a CI job adds and removes modules in every order to prove the wiring holds.
See [Adopt the kit in a new project](docs/guides/adopt-in-new-project.md) and the [ADRs](docs/adr/README.md).

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
- **Top-ups (Stripe test mode):** put your test keys in `.env` (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`), run `bun run stripe:secret` and set the printed `whsec_…` as `STRIPE_WEBHOOK_SECRET`, then `bun run dev` — it also starts the Stripe CLI that forwards webhooks to the API (the `stripe` binary, or Docker). Pay at `Settings → Wallet` with `4242 4242 4242 4242` (any future date and CVC); `4000 0000 0000 0002` is declined. `bun run test:stripe` does both against the running stack.
- **Multi-instance:** `bun run keys:generate && docker compose --profile app up -d --build`, then http://localhost:8080 (2 replicas behind nginx, both with the `api,worker` roles, so both run the relay).

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
- **Delete your account** — scheduled, with a grace period to cancel; then every module erases and confirms, and you get a last mail. Try both at `/settings/account`.
- **Top up your wallet** — pay with a card under Settings → Wallet, in USD, EUR or VND; the balance and the history there update live when Stripe confirms. Needs Stripe test keys (see below); without them the page says top-ups are off.
- **Live events** — a Server-Sent Events stream for session and notification updates, plus a test endpoint to fire your own event.
- **Transactional mail** — magic-link, welcome and email-confirmation mails sent through the outbox, with provider-aware rate limiting and retries.
- **Token verification for other services** — a public JWKS endpoint (`/.well-known/jwks.json`).
- **Health checks** — liveness and readiness probes (`/health/live`, `/health/ready`).

The full endpoint list is in the OpenAPI/Scalar docs (see the URLs above).

## Start a new project

```bash
cd examples/starter                             # identity + profile; needs only Postgres
cp .env.example .env && bun run keys:generate
docker compose up -d postgres && bun run db:migrate && bun run dev

# from the repo root:
bun run kit:add notification billing --app examples/starter   # wire more modules in
bun run gen:module orders --app examples/starter              # or write your own, from templates/module
```

The [adoption guide](docs/guides/adopt-in-new-project.md) covers swapping an adapter, rewording a mail, reacting to an event and ejecting a module;
[use a kit package alone](docs/guides/use-a-kit-package-alone.md) shows the outbox in an existing Elysia app.

## Testing

```bash
bun run test                 # unit: domain + use cases against in-memory fakes (no I/O)
bun run check:arch           # architecture boundary rules (dependency-cruiser)
bun run typecheck && bun run lint
bun run test:e2e             # needs infra: contract suites on the real adapters, the real buildApp + Postgres/S3/Mailpit, then Playwright
bun run check:add-matrix     # the starter with modules added and removed in every order (needs Postgres)
bun run check:docs           # every package README has its sections and its generated config table
bun run build:packages       # dist/ (JavaScript + declarations) of every package, what a registry would serve
bun run quality:unused       # knip — dead code and unused dependencies
bun run quality:dup          # jscpd — copy/paste detection
```

Because use cases depend on ports, the unit suite runs the whole application layer against in-memory fakes in milliseconds;
the e2e suite then proves the real adapters (including outbox retries, mail throttling, SSE and Web Push) against real infrastructure.

## Common commands

| Command | What it does |
| --- | --- |
| `bun run kit:add <module…>` / `kit:remove` | Wire an installed `@mod/*` package into an app (catalog, container, routes, integrations) / take it out (`--app <dir>`, default `apps/api`) |
| `bun run gen:module <name>` / `gen:feature <name>` | Create a module from `templates/module` and wire it / a web feature (folder, route, i18n, registry line) |
| `bun run changeset` | Describe a change to a package; `version-packages` applies the changesets |
| `bun run --filter @app/api db:generate` | Generate migrations per module (after editing `schema.ts`) |
| `bun run --filter @app/api db:migrate` | Run migrations per module (each keeps its history in schema `drizzle_<module>`) |
| `bun run deploy` | Release with a soft stop: maintenance on → drain → migrate → restart → health check → maintenance off ([Operations](docs/architecture/03-runtime-and-operations.md#deploys-bun-run-deploy)) |
| `bun run deploy maintenance on\|off\|status` | Flip maintenance mode by hand (503 for everything but `/health/*`, relay and jobs paused) |
| `bun run --filter @app/api outbox:list` / `outbox:requeue` | List / requeue events that ended up in the dead-letter queue |
| `bun run --filter @app/api keys:generate` | Generate JWT (ES256) and VAPID keys and the step-up code secret into `.env`. The JWT pair is regenerated on every run; an existing VAPID pair and step-up secret are kept (replacing the first unsubscribes every browser, the second voids the codes in flight) |
| `bun run stripe:listen` / `stripe:secret` | Forward Stripe's webhooks to the API (also part of `bun run dev` when a Stripe key is set) / print the webhook signing secret |
| `bun run test:stripe` | Pay with Stripe's test cards against the running stack and check the wallet |
| `bun run infra:down` | Stop the containers (add `-v` to `docker compose down` to delete data) |

## Deliberate trade-offs

Nothing here is free, and the docs say so: access tokens outlive logout by up to 15 minutes (no Redis denylist), the magic-link
throttle can let a few requests slip through under a race, realtime is best-effort (only events that opt in, such as sign-out, are replayed after a reconnect; the rest are refetched), and one shared pool/transaction means you must
review cross-module transactions before splitting. See [Trade-offs and known gaps](docs/architecture/13-trade-offs-and-known-gaps.md).

---

📖 **Go deeper:**
- [docs/architecture.md](docs/architecture.md) — the map: modules, the big picture, and a reading guide to 13 topic pages (messaging, runtime and deploys, identity, realtime, notifications, mail, privacy, billing, web client, i18n, testing and CI, trade-offs).
- [docs/patterns/](docs/patterns/README.md) — 25 reusable techniques from this codebase (outbox, inbox, SKIP LOCKED claiming, Postgres token bucket, pub/sub with replay, idempotent payments, maintenance-mode deploys, …), each written to be lifted into another project.
