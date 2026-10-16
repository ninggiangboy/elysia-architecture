# Architecture

## Design goals

1. **Boundaries that are enforced, not just documented** — layer and module rules fail CI (`check:arch`).
2. **Distributed-ready from day one** — N stateless instances today, any module extractable into a service tomorrow, without rewriting domain/application.
3. **Reliable async by default** — state change and event are one transaction (outbox); consumers are idempotent (inbox).
4. **Few moving parts** — Postgres is the only stateful dependency besides object storage and an SMTP relay; no Redis, no broker until you need one.

## Big picture

```
        ┌─────────────────────── apps/web (React) ───────────────────────┐
        │  Eden Treaty client (types inferred from the API's App type)    │
        │  SSE stream · service worker (Web Push)                         │
        └───────────────┬─────────────────────────────────────────────────┘
                        │ /api  (same origin: Vite proxy / nginx)
┌───────────────────────▼───────────────────────────────────────────────────┐
│ apps/api  (stateless · N instances · APP_ROLES=api,relay)                 │
│                                                                           │
│  presentation ─► application ─► domain             (per module)           │
│                       │  ▲                                                │
│                  ports│  │adapters (infrastructure)                       │
│                       ▼  │                                                │
│  identity ──contracts──► profile        notification        realtime      │
│  (schema identity)       (schema        (schema             (no tables)   │
│     │ outbox              profile)       notification)         ▲          │
│     │                      │ outbox        │ outbox · inbox    │ NOTIFY   │
│     ▼                      ▼               ▼                   │ realtime │
│  OutboxRelay ──► MessagePublisher (InProcessMessageBus) ───────┘          │
│                  each (module, handler.name) = one consumer group         │
└───────────────────────────────────────────────────────────────────────────┘
        Postgres (+ LISTEN/NOTIFY) · SeaweedFS (S3) · SMTP (Mailpit) · Web Push service
```

## Modules

| Module | Owns | Publishes | Consumes | Talks to |
| --- | --- | --- | --- | --- |
| `identity` | users, magic links, refresh-token families (= devices), email-change requests, throttle counters | `magic_link_requested`, `user_registered`, `email_change_requested`, `email_changed`, `session_started`, `session_revoked` | — | — |
| `profile` | profiles (display name, avatar, optimistic-lock `version`) | `avatar_changed` | `user_registered` (create profile), `avatar_changed` (delete old file) | `IdentityApi.getAccount` (sync, for `GET /me`) |
| `notification` | in-app notifications, push subscriptions, mail send-rate state | `created`, `read` | identity events (mail, in-app), `session_revoked` (drop push subscriptions), `created` (Web Push) | — |
| `realtime` | nothing (no tables) | — | `session_revoked`, `notification.created/read` → SSE | — |

Event names are `<module>.<name>.v1` (see each module's `contracts/events.ts`). Contracts are the *only* thing another module may import.

## Layers and dependency rules

Each module has 4 layers; an arrow means "may import":

```
presentation ─► application ─► domain
infrastructure ─► application, domain      (implements ports)
```

| Layer | Contains | Must not know about |
| --- | --- | --- |
| `domain` | Aggregates, value objects, domain events, repository interfaces | Anything else, including frameworks |
| `application` | Use cases, ports (interfaces), integration event handlers | `infrastructure`, `presentation`, Elysia, Drizzle |
| `infrastructure` | Drizzle repositories, JWT, S3, SMTP, outbox | `presentation` |
| `presentation` | Elysia routes, input validation, error → HTTP mapping | — |
| `contracts` | Event types, DTOs, interfaces that other modules may use | Anything inside the module |

These rules are **checked automatically**: `bun run check:arch` (`apps/api/.dependency-cruiser.cjs`) —
domain stays pure, application does not import infrastructure, module A imports only `modules/B/contracts`, `shared` knows no module,
and only the composition root (`app.ts`, `main.ts`, `bootstrap/`) knows concrete adapters.

`bootstrap/container.ts` is the composition root: the only place that wires modules to adapters. No DI container is used; the wiring is manual to keep it readable.

The api's internal imports use the alias `#/*` → `src/*` via `paths` in tsconfig (both Bun and tsc understand it; the web app maps `#/*` to `../api/src/*` to infer types from the backend).

## Distributed-ready principles

Goal: run N instances, and split any module into its own service **without rewriting domain/application**.

1. **Stateless.** No state kept in RAM between requests. Auth uses JWT, rate limits live in the DB, files go straight to S3 via presigned URLs. No sticky sessions needed.
2. **Module = future service.**
   - Each module that persists data has its own Postgres schema (`identity`, `profile`, `notification`), its own migrations, and its own outbox/inbox. `realtime` owns no tables — it is a pure delivery edge.
   - No cross-module FKs or JOINs. `profile.profiles.user_id` only holds the user's id value.
   - All modules share ONE pool and one `UnitOfWork` (`Database`, reads `DATABASE_URL`); modules differ only by Postgres schema. A transaction can span several modules, but keep it within one module so splitting into services later needs no rewrite.
3. **Communicate only through `contracts/`.**
   - Synchronous: interfaces such as `IdentityApi.getAccount` with plain DTOs (ISO strings, no entities). Today it is an in-process call; tomorrow swap in an HTTP client with the same interface. Callers must tolerate errors/timeouts and must not call inside a transaction.
   - Asynchronous: versioned integration events (`identity.user_registered.v1`). Only **add** fields; a breaking change ships as `.v2` and is emitted in parallel.
4. **At-least-once + idempotent.** The outbox makes "write to the DB and emit the event" atomic; the receiving side uses an inbox `(message_id, handler)` so each handler takes effect only once.
   Do not assume ordering between events. Payloads carry enough data (e.g. email) so handlers never call back into the emitting module.
5. **Swappable transport.** The relay pushes through the `MessagePublisher` port. Currently `InProcessMessageBus`; replace it with NATS/Kafka/RabbitMQ without changing handlers (each `(module, handler.name)` is a consumer group).
6. **Correct with multiple instances.**
   - The outbox claims with `FOR UPDATE SKIP LOCKED` + a lease, so any instance can run the relay without duplicating messages.
   - Optimistic locking via a `version` column (409 `version_conflict`).
   - "Consuming" a token (magic link, refresh, email change) is one atomic `UPDATE … WHERE unused AND not expired RETURNING`.
   - Jobs that should run in only one place (outbox cleanup) take `pg_try_advisory_xact_lock`.
7. **Process roles.** `APP_ROLES=api,relay` (default). To split out a worker: run the same image with `APP_ROLES=relay`.
   **Cluster mode.** `APP_WORKERS=N` (or `auto` = one per CPU) makes `main.ts` act as a supervisor that forks N workers (`node:cluster`). Each worker is a full instance — own container, DB pool, SSE sockets and `LISTEN` connection — and binds the same `PORT` with `reusePort`, so the kernel spreads connections (Linux; macOS delivers to one worker, which is fine for development). Nothing else changes because instances were already stateless. Rules: the relay runs only in slot 0 (more would be safe but wasteful); a crashed worker is restarted in its slot, and a crash loop (>5 in 60 s) stops the supervisor so the orchestrator can react; SIGTERM is forwarded and every worker shuts down gracefully. `DB_POOL_MAX` is per worker, so size Postgres for `APP_WORKERS × DB_POOL_MAX` per container.
8. **Verify tokens anywhere.** The ES256 access token carries a `kid`; the public key is at `/api/.well-known/jwks.json`. Other services verify without a shared secret, and keys can be rotated.
9. **Observable.** `x-request-id`/`x-correlation-id` live in AsyncLocalStorage, are attached to every log line (pino JSON) and written into the outbox message `headers`, so logs of async handlers can be traced back to the original request.
10. **Operations.** Configuration through env only; `/health/live` and `/health/ready` (DB ping); graceful shutdown (close live SSE streams → stop accepting requests → stop the relay and wait for the running batch → close the pool); migrations are a separate job; `DB_PREPARE=false` to run behind PgBouncer.

## Typical flows

**Sign in with a magic link**

```
POST /auth/magic-link ──► RequestMagicLink
   throttle (counted in the DB) → MagicLink.issue → [tx: insert magic_links + outbox] → 202
OutboxRelay ──► bus ──► notification.send-magic-link ──► SMTP
POST /auth/magic-link/verify ──► VerifyMagicLink
   [tx: atomic consume → find/create User (+ user_registered event) → new refresh token] → access JWT + cookie
user_registered ──► profile.create-on-user-registered (inbox, same tx)   ┐ two independent consumers
                └─► notification.send-welcome (send mail → write inbox)   ┘
```

**Session**: a 15-minute access JWT (stateless) + an opaque refresh token in the httpOnly cookie `Path=/api/auth`.
Each refresh rotates the token within the same "family"; reusing a rotated token outside the 10-second window is treated as theft and revokes the whole family.
Two tabs refreshing at once (within 10 seconds) are only rejected, and the session is not lost.
A family **is** one signed-in device (its id is the `sid` claim), and each refresh row stores that device's user agent and IP. `GET /account/sessions` lists the user's families that still hold a live refresh token; `DELETE /account/sessions/{id}` (or `DELETE /account/sessions` for all but the current one) revokes them — scoped by `user_id`, so one user can never revoke another's session.

**Realtime (SSE)**: the `realtime` module owns no tables; it pushes events to clients that are connected right now.
- Flow: use case → outbox (`identity.session_started.v1`, `identity.session_revoked.v1`) → relay → `RealtimePushHandler` → `NOTIFY realtime` → every API instance that has a `LISTEN realtime` connection delivers to its own sockets. Postgres is the fan-out, so there is no Redis, no sticky sessions, and the relay may run in a different process from the API.
- One transport, SSE (`GET /realtime/events`), carrying messages `{ id, type, data, at }`. It is consumed with `fetch` (not `EventSource`) so it can send `Authorization: Bearer`. Server → client only is all these use cases need; WebSocket was deliberately left out.
- Remote logout is pushed to the revoked device (`session.revoked`) and the server then closes that session's connections, so the web app signs out immediately instead of after the 15-minute access token. Other devices of the user refresh their device list from the same event.
- Best-effort by design: no replay, events older than 60 s are dropped, and a notification sent while an instance reconnects its LISTEN is lost — clients refetch their state whenever a stream (re)opens. Authentication is checked when the stream opens.
- Deployment: the reverse proxy must not buffer responses and must allow long reads (see `docker/nginx/default.conf`); LISTEN needs a direct Postgres connection, not PgBouncer in transaction mode. On shutdown `realtime.stop()` runs before the HTTP server stops, otherwise open streams would hold it up.

**In-app notifications**: the `notification` module keeps a per-user inbox (`notification.notifications`) next to its mail handlers.
- Flow: identity event (`user_registered`, `email_changed`, `session_started` unless it is the account's first session, `session_revoked` with reason `token_reuse`) → `CreateNotificationHandler` → [tx: insert notification + `notification.created.v1` in the module's outbox + inbox row] → relay → `RealtimePushHandler` → SSE `notification.created`. Realtime only knows the notification *contract*, never its tables.
- API: `GET /notifications` (newest first, cursor = last id since ids are UUIDv7), `GET /notifications/unread-count`, `POST /notifications/{id}/read` (idempotent; another user's id is a 404), `POST /notifications/read-all`. Reading emits `notification.read.v1` only when something changed, so the user's other open devices clear their badge.
- **Web Push** (system notifications while the app is closed) rides the same event: `notification.created.v1` → `WebPushHandler` → `WebPushSender` port (adapter: `web-push` + VAPID) → the browser's push service → `public/sw.js` shows it and opens `data.link` on click. Nothing else in the notification flow knows about it.
  - Opt-in per browser: the web app's toggle (`PushToggle`) asks for permission, subscribes with the VAPID public key from `GET /notifications/push/public-key` and registers the subscription with `PUT /notifications/push/subscription` (idempotent; `DELETE` with the endpoint removes it). Enabled only when `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set (`bun run keys:generate` writes them to `.env` and never overwrites an existing pair — changing the pair invalidates every subscription); otherwise the key endpoint returns `null`, the toggle is hidden and no handler is registered.
  - A subscription belongs to the **login session** that registered it. `identity.session_revoked.v1` (logout, "sign out that device", token theft) deletes it, so a signed-out device stops receiving the account's notifications. The browser's endpoint is unique across users: if another account signs in on the same browser it takes the subscription over. At most 10 per user (oldest dropped).
  - The server POSTs to a URL the client supplied, so the endpoint must be a public `https` URL (no IP literals, `localhost`, `.local`/`.internal`).
  - Delivery: 404/410 from the push service deletes the subscription; 429/5xx/network errors rethrow so the relay retries (the notification `tag` makes a repeated push replace instead of duplicate); other 4xx drop that message. Pushes older than 15 minutes are skipped — the in-app inbox still has them. `sw.js` must not be cached (see `docker/nginx/default.conf`).
- **Alert throttling (many events at once)**: every event still becomes its own stored notification (the inbox and badge are exact), but the *alerts* are limited per user. `WebPushHandler` cuts time into fixed buckets of `PUSH_QUIET_WINDOW_SECONDS` (default 30; `0` = push all) and pushes only the first notification of a user in each bucket, decided from the previous stored notification so a retry reaches the same verdict. `security_alert` is always pushed. The web client does the same for toasts (one per 30 s, security alerts excepted). Mail is separate: rate-limited and deferred, never merged.
- **Folding repeats (prepared, unused)**: a draft may carry `group: { key, withinMs }`; `CreateNotificationHandler` then folds it into the user's latest unread notification of that group (`count` + 1, newest content) and re-emits `notification.created.v1` with the same id. No draft sets it today. Two instances racing on one user can still insert two rows.
- Adding a notification: write a draft function in `application/in-app-notifications.ts` and register one `inApp(...)` handler in `notification.module.ts`; return `null` from the builder to skip events that are not worth one. Retention/cleanup of old notifications is not implemented yet.

**Avatar**: `POST upload-url` issues a presigned PUT (5 minutes) → the browser PUTs straight to SeaweedFS → `PUT /me/avatar {key}` checks the key belongs to the user and `stat`s size/type
(a presigned PUT cannot enforce them, so a bad file is deleted) → emits `profile.avatar_changed.v1` → a handler deletes the old file.

## Sending mail and rate limiting

Mail goes through the outbox, so it never slows down or breaks a request. "Sending in a way the provider will not reject" has four layers:

```
OutboxRelay ─► MailEventHandler ─► ThrottledMailer ─► real Mailer (SMTP / SES…)
   ▲                │  expired → skip        │ acquire()/penalize()
   │                │  permanent → skip+log  ▼
   └── deferred to the right time ◄── RetryLaterError ── PostgresSendRateLimiter (token bucket + daily quota)
```

1. **Proactive limit** (`ThrottledMailer` + `PostgresSendRateLimiter`): a token bucket `MAIL_RATE_PER_SECOND` (burst `MAIL_BURST`) and a daily quota `MAIL_DAILY_QUOTA`.
   State lives in Postgres and every permission request is one atomic upsert, so N instances share one limit. When the quota runs out it fails with the exact time to wait, without touching the provider.
2. **Adaptive**: if the provider still reports overload (SES `454 Throttling failure`, Gmail `550 5.4.5`…), the bucket is put "in debt" (`penalize`) so every instance backs off together instead of continuing to hammer.
3. **The relay understands "retry later"** (`RetryLaterError`): it defers the message to the suggested time (+ jitter ≤10%) and **gives back** the attempt it just counted, so a long rate-limit spell does not push mail to dead. It gives up only when the message is older than `OUTBOX_DEFER_BUDGET_HOURS` (default 24 hours).
   Ordinary errors (lost connection, bad credentials 535…) still follow exponential backoff, up to 10 attempts.
4. **Pointless mail is not sent**: magic link / email-change links carry `expiresAt`; if a mail is deferred past that, it is skipped instead of sending a dead link. A permanent failure for one address (550/554) drops only that mail and logs `error`, without sending the whole event to dead or blocking other consumers.

Dead-letter operations: `bun run --filter @app/api outbox:list` and `outbox:requeue [-- --id <uuid> | --type <event>]`.
Requeue is safe because the inbox blocks handlers that already finished, so nothing is sent twice.

### Using Amazon SES

- **Quick way, no code**: SES has an SMTP interface. Set `SMTP_HOST=email-smtp.<region>.amazonaws.com`, `SMTP_PORT=587`, `SMTP_REQUIRE_TLS=true`, `SMTP_USER`/`SMTP_PASSWORD` (the SES SMTP credentials), and `MAIL_FROM` to a verified address.
  Set `MAIL_RATE_PER_SECOND` to the account's *maximum send rate* and `MAIL_DAILY_QUOTA` to its *24-hour sending quota* (sandbox: 1/second, 200/day). The `454` error is recognised as a rate limit; `554 Message rejected` (e.g. recipient not verified in the sandbox) is permanent.
- **Use the SES API (AWS SDK)** when you need a configuration set, tags or bounce tracking: write `SesMailer implements Mailer`, map `ThrottlingException`/`Maximum sending rate exceeded`/`Daily message quota exceeded` → `MailRateLimitedError`, and `MessageRejected`/`MailFromDomainNotVerified` → `MailPermanentError`; pass it to `createContainer(config, logger, { mailer })`. The bucket, deferral, expiry and dead-letter behaviour stay the same.
- SES bounces/complaints arrive via SNS: add an endpoint/handler that records bounced addresses and blocks resending (a suppression list) — not in the project yet.

## Testing and CI

| Level | Command | What it proves |
| --- | --- | --- |
| Domain + use cases | `bun run test` | Business rules and orchestration against in-memory fakes (`shared/testing/fakes.ts`) — no I/O, runs in milliseconds. Possible only because use cases depend on ports. |
| Architecture | `bun run check:arch` | The layer/module rules above, via dependency-cruiser. |
| API e2e | `bun run test:e2e` (api) | The real `buildApp` against real Postgres/S3/Mailpit: full flows, outbox retry and dead-letter, mail throttling, SSE, Web Push (with a fake push sender). |
| Web e2e | `bun run test:e2e` (web) | Playwright journeys: sign-in, profile, realtime sign-out, notifications. |
| Hygiene | `quality:unused`, `quality:dup`, `lint` | knip (dead code/deps), jscpd (duplication), Biome (lint + format). |

GitHub Actions: **CI** (lint, typecheck, `check:arch`, unit, build; then e2e with the compose infra and Playwright; image scan with Trivy),
**Code quality** (coverage, knip, jscpd, Biome annotations) and **Security** (gitleaks, Trivy filesystem/IaC, CodeQL).

## Adding a module

1. Create `modules/<name>/{domain,application,infrastructure,presentation,contracts}` plus `<name>.module.ts` (a factory returning `routes`, `handlers` and, if it publishes events, its `outbox`).
2. If it persists data: a Drizzle `schema.ts` in its own Postgres schema; add its name to `MODULES` in `scripts/db.ts` so `db:generate`/`db:migrate` pick it up (`drizzle.config.ts` takes the module from the `MODULE` env var; each module gets its own `drizzle_<name>` history table).
3. Put events and sync interfaces in `contracts/` only (versioned names, plain DTOs). Other modules import nothing else from it.
4. Wire it in `bootstrap/container.ts` (subscribe its handlers to the bus, add its outbox to the `OutboxRelay`) and mount its routes in `app.ts`.
5. Write handlers as idempotent integration-event handlers; the inbox guards them, but side effects outside the DB (mail, push) must tolerate a retry.
6. `bun run check:arch` — if it fails, a boundary was crossed.

## Deliberate trade-offs

- **Logout (and remote logout of a device) does not revoke the access token immediately**: it stays valid for up to 15 minutes. Making it instant needs a denylist in a fast store (Redis) — the project deliberately avoids Redis.
- **Magic-link rate limit in Postgres** (3/email, 10/IP per 15 minutes): correct with many instances, but a few extra requests can slip through under a race. Enough to stop spam; for something stricter, replace the adapter of the `MagicLinkThrottle` port.
- **`x-forwarded-for` is trustworthy only behind a reverse proxy we control** (the nginx in compose sets it). Do not expose the API directly to the Internet while still trusting this header.
- **Mail rate limiting uses one shared bucket for all mail types**: important mail (magic link) may queue behind welcome mail under load. If you need priority, split buckets by type (the `key` parameter) or order by priority when claiming.
- **The raw magic-link token sits in the outbox** until cleanup (published messages are deleted after 7 days). For something stricter: encrypt the payload or wipe it right after publishing.
- **Synchronous cross-module calls (`IdentityApi`)** make `GET /me` depend on identity. When splitting services you need a timeout + fallback; today `GET /me` tolerates a *missing profile* but not an identity outage.
- **One pool and one shared transaction for all modules**: convenient and saves connections, but modules are not forced to isolate their transactions. When splitting services, review every place where a transaction spans several modules.

## Checklist: splitting a module into a service

For example splitting out `notification` (the simplest) or `profile`:

1. **Data**: create a separate database for the new service, point its `DATABASE_URL` at it and run `db:migrate` for that module (migrations are already split per module; you need to restrict the module list in `scripts/db.ts`). There are no cross-module FKs, so nothing needs cutting.
2. **Transport**: write a `MessagePublisher` + consumer for a real broker (NATS/Kafka/…): the emitting module's relay publishes to the broker; the new service subscribes per `(module, handler.name)`. Handlers stay unchanged because they are already idempotent.
3. **Synchronous calls**: for a contract other modules call (e.g. `IdentityApi`), write `HttpIdentityApi implements IdentityApi` and change the wiring in the composition root. Add timeouts, retries and a circuit breaker.
4. **Auth**: the new service verifies JWTs with identity's JWKS (`createRemoteJWKSet`) instead of the in-process `AccessTokenVerifier`.
5. **Deployment**: reuse the image, set a suitable `APP_ROLES` (`api`, `relay`) and mount only that module's routes/handlers in the new composition root.
6. **Verify**: `check:arch` must stay clean (no module imports another module's internals); rerun e2e over the network.
