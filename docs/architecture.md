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
│ apps/api  (stateless · N instances · APP_ROLES=api,worker)                │
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

`privacy` (schema `privacy`) is not drawn: it sits beside the others and talks to identity / profile / notification only through events (see *Privacy* below).

## Modules

| Module | Owns | Publishes | Consumes | Talks to |
| --- | --- | --- | --- | --- |
| `identity` | users, magic links, refresh-token families (= devices), email-change requests, throttle counters, passkeys, OAuth links, WebAuthn challenges / OAuth states / step-up codes (all short-lived) | `magic_link_requested`, `user_registered`, `email_change_requested`, `email_changed`, `session_started`, `session_revoked`, `step_up_code_requested`, `passkey_added`, `passkey_removed`, `oauth_account_linked`, `oauth_account_unlinked`, `data_exported`, `user_data_erased` | `data_export_requested`, `account_erasure_requested` (privacy) | — |
| `profile` | profiles (display name, avatar, cover image, optimistic-lock `version`) | `avatar_changed`, `cover_changed`, `data_exported`, `user_data_erased` | `user_registered` (create profile), `avatar_changed` (delete old file, make thumbnails), `cover_changed` (delete old file), `data_export_requested`, `account_erasure_requested` (privacy) | `IdentityApi.getAccount` (sync, for `GET /me`) |
| `notification` | in-app notifications, push subscriptions, mail send-rate state | `created`, `read`, `data_exported`, `user_data_erased` | identity events (mail, in-app — including the security alerts for added/removed sign-in methods), `session_revoked` (drop push subscriptions), `created` (Web Push), privacy events (export ready/failed, deletion scheduled/cancelled/done → mail + in-app), `billing.topup_succeeded` (in-app), `data_export_requested`, `account_erasure_requested` | — |
| `privacy` | the *ledger* of two jobs: `export_requests` + `export_parts`, `account_deletions` + `deletion_steps` (never the data itself); archives in the bucket under `exports/<userId>/` | `data_export_requested`, `data_export_progressed`, `data_export_ready`, `data_export_failed`, `account_deletion_scheduled`, `account_deletion_cancelled`, `account_erasure_requested`, `account_erasure_progressed`, `account_deletion_stalled`, `account_deleted` | every participant's `<module>.data_exported` and `<module>.user_data_erased` (one consumer group per module and direction) | `IdentityApi.getAccount` (sync, only for the address to mail) |
| `billing` | top-ups (one attempt to add money, settled by Stripe's webhook), the append-only ledger, one wallet balance per user and currency, and the numbered documents (invoice, receipt, credit note) | `topup_succeeded`, `topup_failed`, `data_exported`, `user_data_erased` | `data_export_requested`, `account_erasure_requested` (privacy) | Stripe (`PaymentGateway` port); `IdentityApi.getAccount` and `ProfileApi.getDisplayName` (sync, to name the buyer on an invoice) |
| `realtime` | `realtime.events` (replay buffer, opt-in events only) | — | `session_revoked`, `notification.created/read`, `billing.topup_succeeded/failed` → SSE; `privacy.*` job steps → SSE (replayed); `account_deleted` → purge the user's buffer | — |

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
   - Each module that persists data has its own Postgres schema (`identity`, `profile`, `notification`), its own migrations, and its own outbox/inbox. `realtime` only owns a short replay buffer (`realtime.events`, events that opt in, for a few minutes) — it is a delivery edge, not a store.
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
7. **Process roles.** `APP_ROLES=api,worker` (default). To split out a worker: run the same image with `APP_ROLES=worker`.
   **Cluster mode.** `APP_PROCESSES=N` (or `auto` = 3/4 of the CPUs, at least 2) makes `main.ts` act as a supervisor that forks N processes (`node:cluster`). Each process is a full instance — own container, DB pool, SSE sockets and `LISTEN` connection — and binds the same `PORT` with `reusePort`, so the kernel spreads connections (Linux; macOS delivers to one process, which is fine for development). Nothing else changes because instances were already stateless. Rules: the worker role's relay runs only in slot 0 (more would be safe but wasteful); a crashed process is restarted in its slot, and a crash loop (>5 in 60 s) stops the supervisor so the orchestrator can react; SIGTERM is forwarded and every process shuts down gracefully. `DB_POOL_MAX` is per process, so size Postgres for `APP_PROCESSES × DB_POOL_MAX` per container.
8. **Verify tokens anywhere.** The ES256 access token carries a `kid`; the public key is at `/api/.well-known/jwks.json`. Other services verify without a shared secret, and keys can be rotated.
9. **Observable.** `x-request-id`/`x-correlation-id` live in AsyncLocalStorage, are attached to every log line (pino JSON) and written into the outbox message `headers`, so logs of async handlers can be traced back to the original request.
   **Tracing.** With `OTEL_EXPORTER_OTLP_ENDPOINT` set (Jaeger from `docker-compose.yml`: UI `:16686`, OTLP/HTTP `:4318`), `main.ts` registers an OpenTelemetry provider; without it every span call is a no-op. One trace covers the whole async chain: the `tracingPlugin` opens a SERVER span per request (continuing an incoming `traceparent`) → `DrizzleOutboxWriter` stores the current span's W3C `traceparent` in the message `headers` (inside the same transaction) → `OutboxRelay` opens an `outbox.relay <type>` span as a child of it, however long the message waited or which instance claims it → `InProcessMessageBus` opens one `handle <handler>` span per handler. A handler that writes a follow-up event to an outbox carries the trace on again, so the chain continues across any number of hops. Retries show up as extra relay spans on the same trace; a `RetryLaterError` deferral is not marked as an error.
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

**Sign in with a passkey (WebAuthn)**

```
POST /auth/passkey/options ──► BeginPasskeyLogin         challenge stored in identity.webauthn_challenges (5 min, single use)
browser: navigator.credentials.get()                      no email typed: the browser offers the passkeys it holds for this site
POST /auth/passkey/verify  ──► FinishPasskeyLogin
   consume challenge (purpose = login) → passkey by credential id → verify signature, origin, rpId, user verification
   → counter must advance (when the authenticator counts) → [tx: new session + session_started] → access JWT + cookie
```

Adding a passkey is `POST /account/passkeys/options` then `POST /account/passkeys` (needs a recent confirmation, see step-up). Passkeys are discoverable and always require user verification, so one is a complete sign-in on its own. Challenges live in Postgres (not in memory) because any instance may answer the second request; each one is bound to a purpose (`register`, `login`, `step_up`) and, for the last two, a user, so a challenge made for one ceremony cannot finish another. Synced passkeys (iCloud, Google) always report counter 0, so a counter that does not move is only suspicious when it ever did. `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGINS` default to `WEB_APP_URL`: changing the RP id orphans every registered passkey.

**Sign in with Google / GitHub (OAuth)**

```
POST /auth/oauth/{provider}/start ──► BeginOAuth        state (hashed) + PKCE verifier stored in identity.oauth_states (10 min, single use)
browser ──► provider ──► WEB_APP_URL/auth/oauth/callback?code&state     (a page of the web app, like the magic-link page)
POST /auth/oauth/callback {code, state} ──► CompleteOAuth
   consume state → exchange code (+ verifier) → profile { id, email, emailVerified }
   login: (provider, id) known → that user
          else verified email → existing user with that email (link it) or a new user
          else → 400 oauth_email_unverified
   link:  must be called with the access token of the user who started it (state.userId), else 403
```

Providers are on only when both `*_CLIENT_ID` and `*_CLIENT_SECRET` are set; the redirect URI to register with them is `${WEB_APP_URL}/auth/oauth/callback`. The account is matched on the provider's stable id, never on email once linked. Before linking, the email must be one the provider vouches for (Google `email_verified`; GitHub: the *primary, verified* address from `/user/emails` — the profile email is user-typed and ignored); that is the same proof a magic link gives, so linking by it does not widen who can take an account over. Connecting from settings is bound to the user who started it: otherwise a victim could be tricked into attaching their Google account to the attacker's. The email sign-in always remains, so disconnecting can never lock anyone out.

**Step-up (confirm again before sensitive actions)**

Access tokens carry an `auth_time` claim (seconds): set when the user *just* authenticated (magic link, passkey, OAuth, or a step-up), absent on tokens from a plain refresh. `StepUpPolicy` (window `STEP_UP_TTL`, default 5 minutes) is checked **inside the use case**, not in the route: changing the email, adding/removing a passkey, connecting/disconnecting an OAuth account answer `403 step_up_required` otherwise. A stolen access token that is older than the window — or any token obtained by stealing only the refresh cookie — cannot reach these actions.

```
403 step_up_required ──► client opens "confirm it is you"
   passkey:  POST /account/step-up/passkey/options → get() → /verify      (only the account's own passkeys)
   email:    POST /account/step-up/email-code → 6-digit code by mail → POST …/verify {code}
   both return a new access token for the SAME session with auth_time = now → client retries the action once
```

The emailed code is hashed (with the user id), valid 10 minutes, replaced by the next request, limited to 5 wrong guesses and 5 requests per 15 minutes. It proves control of the mailbox — the same root of trust as the magic link — so it is a weaker confirmation than a passkey but still stops anyone who holds only the session.

**Session**: a 15-minute access JWT (stateless) + an opaque refresh token in the httpOnly cookie `Path=/api/auth`.
Each refresh rotates the token within the same "family"; reusing a rotated token outside the 10-second window is treated as theft and revokes the whole family.
Two tabs refreshing at once (within 10 seconds) are only rejected, and the session is not lost.
A family **is** one signed-in device (its id is the `sid` claim), and each refresh row stores that device's user agent and IP. `GET /account/sessions` lists the user's families that still hold a live refresh token; `DELETE /account/sessions/{id}` (or `DELETE /account/sessions` for all but the current one) revokes them — scoped by `user_id`, so one user can never revoke another's session.

**Realtime (SSE)**: the `realtime` module pushes events to clients that are connected right now, and replays the few events that opt in to a client that reconnects.
- Flow: use case → outbox (`identity.session_started.v1`, `identity.session_revoked.v1`) → relay → `RealtimePushHandler` → `NOTIFY realtime` (replayable events: plus an insert into `realtime.events` in the same tx) → every API instance that has a `LISTEN realtime` connection delivers to its own sockets. Postgres is the fan-out, so there is no Redis, no sticky sessions, and the relay may run in a different process from the API.
- One transport, SSE (`GET /realtime/events`), carrying messages `{ id, type, data, at }`. It is consumed with `fetch` (not `EventSource`) so it can send `Authorization: Bearer`. Server → client only is all these use cases need; WebSocket was deliberately left out.
- Remote logout is pushed to the revoked device (`session.revoked`) and the server then closes that session's connections, so the web app signs out immediately instead of after the 15-minute access token. Other devices of the user refresh their device list from the same event.
- **Replay is opt-in per event** (`RealtimeEvent.replay`, default off). Most events here mean "something changed, refetch" and are neither stored nor given an id; clients refetch that state on every `ready`. Only events whose loss a refetch cannot repair set `replay: true` — today just `session.revoked`: a device that was offline when it was signed out reconnects with a still-valid access token and must learn it was signed out, not wait for the token to expire. The steps of the privacy jobs (`privacy.export.progress/ready/failed`, `privacy.deletion.progress`) are the second user: a client that was away must still learn how the job went. Future candidates: chat messages.
- How it works: a replayable event is inserted into `realtime.events` and `NOTIFY`-ed in one transaction (publishers take a per-user advisory lock, so the global `seq` is in commit order per user); `seq` is the SSE `id:`. `ready` carries a `cursor` (the newest `seq` at connect time), so even a client that never saw a replayable event has something to send back as `Last-Event-ID`; each replayable event then moves it forward. On reconnect `ready` says `resumed: true` and the missed replayable events follow it in order before live delivery continues (the connection is subscribed before the buffer is read; the overlap is de-duplicated). Replaying an event that carries `closeSessionId` hangs up that session's connection like the live one would.
- The buffer is trustworthy only if nothing after the cursor was pruned: the cursor must be ≤ the newest `seq` and ≥ the oldest stored `seq` − 1. Otherwise (no/malformed/future/too-old cursor, or more than 200 missed events) `resumed: false` and nothing is replayed — the client resyncs. The header is untrusted input, parsed as a plain integer, and rows are always filtered by the authenticated user. The buffer is pruned every minute to `REALTIME_REPLAY_WINDOW_SECONDS` (default 900, i.e. the access-token TTL: past it the device cannot refresh its session anyway).
- Still best-effort for everything else: events older than 60 s when the relay delivers them are dropped, and a non-replayable event sent while a client is offline or an instance reconnects its LISTEN is not delivered — the refetch on `ready` covers it. Authentication is checked when the stream opens.
- Deployment: the reverse proxy must not buffer responses and must allow long reads (see `docker/nginx/default.conf`); LISTEN needs a direct Postgres connection, not PgBouncer in transaction mode. On shutdown `realtime.stop()` runs before the HTTP server stops, otherwise open streams would hold it up.

**In-app notifications**: the `notification` module keeps a per-user inbox (`notification.notifications`) next to its mail handlers.
- Flow: identity event (`user_registered`, `email_changed`, `session_started` unless it is the account's first session, `session_revoked` with reason `token_reuse`) → `CreateNotificationHandler` → [tx: insert notification + `notification.created.v1` in the module's outbox + inbox row] → relay → `RealtimePushHandler` → SSE `notification.created`. Realtime only knows the notification *contract*, never its tables.
- API: `GET /notifications` (newest first, cursor = last id since ids are UUIDv7), `GET /notifications/unread-count`, `POST /notifications/{id}/read` (idempotent; another user's id is a 404), `POST /notifications/read-all`. Reading emits `notification.read.v1` only when something changed, so the user's other open devices clear their badge.
- **Live list**: `notification.created` carries the whole notification (incl. `count`), so the web app patches it into the cached list (new → on top, a folded repeat → replaced in place) and `notification.read` flips `read` in place; only the two counts are refetched. Events are not replayed, so a (re)connect refetches everything.
- **Optimistic writes** (web): mark read / mark all read and sign out device / sign out other devices update the cache first (`onMutate`), undo from a snapshot if the request fails, and resync with the server when the last in-flight one settles. Forms, uploads and the push toggle stay pessimistic: the server can reject them or the browser must answer first.
- **Unseen vs unread**: the bell badge counts *unseen* notifications, not unread ones. Unseen = still unread and `notified_at` (creation time, bumped when a repeat is folded in) is later than the user's `notification.inbox_state.seen_at`. `GET /notifications/unseen-count` reads it; `POST /notifications/seen` (the web app calls it when the bell popover opens) moves `seen_at` forward and emits `notification.seen.v1` — only if the badge was showing something — so other open devices clear theirs. Read state is untouched; `unread-count` still reports it.
- **Web Push** (system notifications while the app is closed) rides the same event: `notification.created.v1` → `WebPushHandler` → `WebPushSender` port (adapter: `web-push` + VAPID) → the browser's push service → `public/sw.js` shows it and opens `data.link` on click. Nothing else in the notification flow knows about it.
  - Opt-in per browser: the web app's toggle (`PushToggle`, on the notification settings page opened from the bell popover) asks for permission, subscribes with the VAPID public key from `GET /notifications/push/public-key` and registers the subscription with `PUT /notifications/push/subscription` (idempotent; `DELETE` with the endpoint removes it). Enabled only when `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set (`bun run keys:generate` writes them to `.env` and never overwrites an existing pair — changing the pair invalidates every subscription); otherwise the key endpoint returns `null`, the toggle is hidden and no handler is registered.
  - A subscription belongs to the **login session** that registered it. `identity.session_revoked.v1` (logout, "sign out that device", token theft) deletes it, so a signed-out device stops receiving the account's notifications. The browser's endpoint is unique across users: if another account signs in on the same browser it takes the subscription over. At most 10 per user (oldest dropped).
  - The server POSTs to a URL the client supplied, so the endpoint must be a public `https` URL (no IP literals, `localhost`, `.local`/`.internal`).
  - Delivery: 404/410 from the push service deletes the subscription; 429/5xx/network errors rethrow so the relay retries (the notification `tag` makes a repeated push replace instead of duplicate); other 4xx drop that message. Pushes older than 15 minutes are skipped — the in-app inbox still has them. `sw.js` must not be cached (see `docker/nginx/default.conf`).
- **Alert throttling (many events at once)**: every event still becomes its own stored notification (the inbox and badge are exact), but the *alerts* are limited per user. `WebPushHandler` cuts time into fixed buckets of `PUSH_QUIET_WINDOW_SECONDS` (default 30; `0` = push all) and pushes only the first notification of a user in each bucket, decided from the previous stored notification so a retry reaches the same verdict. `security_alert` is always pushed. The web client does the same for toasts (one per 30 s, security alerts excepted). Mail is separate: rate-limited and deferred, never merged.
- **Folding repeats (prepared, unused)**: a draft may carry `group: { key, withinMs }`; `CreateNotificationHandler` then folds it into the user's latest unread notification of that group (`count` + 1, newest content) and re-emits `notification.created.v1` with the same id. No draft sets it today. Two instances racing on one user can still insert two rows.
- Adding a notification: write a draft function in `application/in-app-notifications.ts` and register one `inApp(...)` handler in `notification.module.ts`; return `null` from the builder to skip events that are not worth one. Retention/cleanup of old notifications is not implemented yet.

**Avatar**: `POST upload-url` issues a presigned PUT (5 minutes) → the browser PUTs straight to SeaweedFS → `PUT /me/avatar {key}` checks the key belongs to the user and `stat`s size/type
(a presigned PUT cannot enforce them, so a bad file is deleted) → emits `profile.avatar_changed.v1` → a handler deletes the old file.

**Cover image**: the same flow under `/me/cover` (up to 5 MB). Cover keys live in `<userId>/cover/`, which keeps them apart from avatars — `PUT /me/avatar` refuses a cover key, so each cleanup handler (`profile.cover_changed.v1` → delete the old file) can only ever delete its own kind of file.

## Privacy: data export and account deletion

Two jobs that run *through* every module. `privacy` owns the process and its progress; it never reads or deletes another module's data — it asks, and each module answers with an event. Splitting a module into a service changes nothing here: the service consumes the two request events and emits its two answers (see the checklist).

```
                        ┌─ identity.export-user-data ─┐
privacy.data_export_    │  profile.export-user-data   │   <module>.data_exported       privacy.record-export-part:<module>
requested ──────────────┼─ notification.export-…  ────┼──► (key of its JSON in S3) ──►  tick it off; the last one → export_collected
                        └─────────────────────────────┘                                          │
                                     writes under exports/<userId>/<exportId>/parts/              ▼
                                                                     privacy.assemble-export → zip → data_export_ready ─► mail + in-app
```

**Export**
- `POST /privacy/exports` (needs a recent confirmation, see step-up) inserts the job (`export_requests` with one `export_parts` row per participant) and `privacy.data_export_requested.v1` in one transaction. One export at a time per user (a partial unique index, so two clicks cannot both win).
- Each participant's handler collects its data (`DataExporter`), writes `<uploadPrefix><module>.json` to the bucket and answers `<module>.data_exported.v1` carrying the key and any extra files to ship (profile: avatar and cover originals). The write comes first and is idempotent, so an answer always points at a file.
- `RecordExportPart` ticks the module off **under a row lock** (`FOR UPDATE`): two modules answering at once are applied one after the other, so exactly one sees the set complete and starts the assembly. Every part emits `data_export_progressed` (`done` / `total`).
- `AssembleExport` reads the parts, builds `README.txt`, `data/<module>.json` and `files/…` into a zip (`fflate`, in memory: the data is bounded), writes `archive.zip`, asks `IdentityApi.getAccount` for the address (not stored in privacy), presigns a link that lives `PRIVACY_EXPORT_TTL` (≤ 7 days, the S3 limit) and emits `data_export_ready`. Then the parts are deleted: they were a means.
- The link goes in **the mail** (notification keeps `expiresAt` on it, so a late mail is skipped rather than sent dead) — the mailbox is the same root of trust as a magic link. The in-app notification only points to `/settings/account`; it never holds the link. From the page `GET /privacy/exports/{id}/download` issues a fresh 15-minute link and, like the request, needs a recent confirmation: an access token alone cannot take the archive.
- After `PRIVACY_EXPORT_TTL` the jobs mark the export `expired` and delete its folder.

**Account deletion**

```
POST /privacy/deletion ─► scheduled (grace period PRIVACY_DELETION_GRACE_PERIOD, mail + notification, cancellable)
                              │ jobs: scheduled_for reached
                              ▼
                   running ── account_erasure_requested{modules} ──► identity / profile / notification / privacy erase
                       ▲                                              (data + published outbox rows + S3 prefix), each in ONE
                       │ jobs: quiet for PRIVACY_STALL_AFTER           transaction with its <module>.user_data_erased
                       │ → re-send to the modules still owed                         │
                       │   (up to PRIVACY_MAX_NUDGES)                                ▼
                    stalled ◄────────────────────────────  privacy.record-erasure:<module> ticks the step, emits
                       │ privacy:resume                       account_erasure_progressed; the last one completes the job
                       └─► running                            and emits account_deleted → goodbye mail, purge realtime buffer
```

- `POST /privacy/deletion` needs a recent confirmation (this closes the old trade-off: deletion is the sensitive action `StepUpPolicy` was kept for — the policy now lives in `shared/application` so privacy can use it). It only *schedules*: the row, the address (kept to say goodbye) and `account_deletion_scheduled`, which becomes a mail with a cancel link and a security-alert notification. Signing in during the grace period does **not** cancel it; `GET /privacy/deletion` is how a client finds out and offers to cancel (the web app's `/settings/account` page does).
- `DELETE /privacy/deletion` cancels while `scheduled`; once `running` it answers `409 deletion_in_progress` — erasing cannot be undone, and half-undoing it would be worse than finishing.
- **The clock is a job, not an event.** `PrivacyJobs.runOnce` (a timer in the worker role, `PRIVACY_JOBS_INTERVAL_SECONDS`) starts due deletions, re-sends to silent modules and expires exports. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so any number of instances can tick without repeating each other's work.
- **Failures.** A handler that throws is retried by the relay with backoff like any other (the common case, handled below privacy). What the relay cannot see is a module that never answers (message dead-lettered, service down): after `PRIVACY_STALL_AFTER` without progress the request is re-sent **only to the modules still owed** (new message id → the inbox does not block the retry; the erasure is idempotent anyway), up to `PRIVACY_MAX_NUDGES`. Then the deletion becomes `stalled`, `account_deletion_stalled` is emitted and an `error` is logged — a person has to look (`bun run --filter @app/api privacy:list`; fix the cause, `outbox:requeue` if a message is dead, then `privacy:resume -- --id <uuid>`). A stalled job still accepts a late confirmation and completes by itself. To the user a stalled deletion looks like a running one. An export that never gets all its parts is *failed* instead (the user is told and may ask again): nothing was lost, only a copy not made.
- **Each module's erasure** removes everything it holds about the user — profile, every file under `<userId>/` (including uploads never set as avatar), notifications and push subscriptions, sessions, passkeys, links, challenges — **and the published outbox messages about them** (they keep addresses and tokens until the relay's retention cleanup). Messages not yet published are left: they are still owed to their consumers. No event announces the erasure of sessions: a "signed out" notification for a deleted account would be new data about them. The module's own confirmation (ids and a time) stays in its outbox.
- Privacy takes part in its own erasure (archives and their records; the addresses of earlier, cancelled deletions). The running deletion's row stays as proof the erasure happened, with the address scrubbed on completion.
- Realtime has no outbox, so it cannot confirm; it purges the user's replay-buffer rows on `account_deleted` (best effort — the buffer expires in `REALTIME_REPLAY_WINDOW_SECONDS` anyway).

**Progress in the browser.** The steps are replayable realtime events (`privacy.export.progress`, `privacy.export.ready/failed`, `privacy.deletion.progress`), the case the replay buffer was designed for: a tab that was away reconnects with `Last-Event-ID` and still gets how the job went. They carry counts and module names — never the download link, because the buffer is stored. `done` is a count, not a step number: delivery is not ordered across relay instances, so a client keeps the highest value (the web app simply refetches).

## Billing: topping up a wallet with Stripe

Money only moves on Stripe's word. `POST /billing/topups` creates a Stripe PaymentIntent and a `pending` top-up, and returns the client secret; the browser completes the payment with our own card form, which confirms the intent by calling Stripe's API directly with the publishable key (the card never reaches our server; Stripe must allow raw card data on the account). 3-D Secure comes back through the `return_url` redirect. The wallet is credited by the webhook (`POST /billing/webhooks/stripe`, no bearer token: the `Stripe-Signature` over the *raw* body is the authentication), never by the page the buyer is sent back to — that page only polls the top-up until it settles.

- **Exactly once.** Stripe delivers at least once and in no promised order. Settling is a conditional update (`pending|failed → succeeded`), and the ledger entry, the balance and the `billing.topup_succeeded.v1` event are written in the same transaction, so a repeat finds the top-up already settled and changes nothing. A late `failed` after `succeeded` is ignored. A declined card leaves the top-up `failed`, but it can still become `succeeded` (the same payment, another card).
- **Never trust the amount twice.** The webhook's amount and currency must equal what the top-up asked for, or nothing is credited. Money that cannot be explained (a wrong amount, a payment after the account was erased, a payment that names a top-up we do not have, a balance pushed below zero) is written to `billing.payment_anomalies` — one row per payment and kind — and logged at `error`; nothing is fixed automatically, a person looks. Every event is also recorded in `billing.payment_events` (result, number of deliveries), to answer "why was this not credited?".
- **Starting a top-up is idempotent.** `POST /billing/topups` takes an optional `Idempotency-Key` header (8–64 of `A-Za-z0-9_-`). Same user + same key + same body returns the first top-up and its client secret instead of a second payment (unique index on `(user_id, idempotency_key)`, and the key, scoped to the user, is also Stripe's idempotency key, so two requests racing reach the same PaymentIntent); the same key with another amount is `409 idempotency_key_reused`. The web form sends one key per currency+amount choice.
- **Refunds and disputes** adjust a settled top-up through the same webhook path, as negative ledger entries (`refund`, `chargeback`) and a positive one when a dispute is won (`chargeback_reversal`), each booked once per Stripe id (unique `(type, reference)`). The top-up itself stays `succeeded`. An adjustment that arrives before its payment is settled (or a win before the dispute's opening) answers `409 payment_not_settled_yet`, so Stripe delivers it again. A balance may go below zero (the money really left); that raises an anomaly.
- **A lost webhook is made up for.** A worker job (`BILLING_RECONCILE_INTERVAL_SECONDS`) claims open top-ups (`pending`, or `failed` and still completable) older than `BILLING_SETTLE_GRACE` and younger than `BILLING_RECONCILE_MAX_AGE`, asks Stripe for the PaymentIntent and feeds the answer through `HandlePaymentEvent` — the same code path as the webhook, so the two cannot double-credit. Claims are stamped (`reconciled_at`, `FOR UPDATE SKIP LOCKED`) so instances and passes do not repeat each other.
- **Integers only.** Amounts are integers in the currency's smallest unit (cents, whole dong); `@app/shared-types` lists the offered currencies and their range, the API enforces it, the web app only reads it for presets. One balance per currency, no conversion.
- **Off without keys.** The three `STRIPE_*` variables are set together or not at all; without them balances and history still read and top-ups answer `404 billing_disabled`.
- **Erasure keeps the records.** A payment is a financial document: erasing an account sets `user_id` to null on its top-ups and ledger entries and deletes the balances, so nothing points back to the person. (Stripe keeps its own copy, with the user id in the payment's metadata, under its retention rules.)
- **Invoices, receipts and credit notes** (`billing.documents`) are issued by `DocumentIssuer` in the same transaction as the money movement they document, so there is never a wallet change without its paper nor the reverse. Starting a top-up stores it together with an `open` **invoice**; the webhook that credits the wallet marks the invoice `paid` and issues one **receipt** in that same transaction (a declined card leaves the invoice open, a canceled payment makes it `void`). A refund or a lost dispute issues a **credit note** against the invoice, once per Stripe refund/dispute id; winning the dispute voids it. A top-up that began before invoices existed is billed, already paid and with a blank buyer, when it succeeds. Documents are immutable snapshots: seller (`SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_TAX_ID`, `SELLER_EMAIL`), buyer (the profile name and account email, or the company name, tax id and address typed in the optional `billing` object of `POST /billing/topups`) and lines are frozen when issued; only an invoice's or a credit note's `status` moves. The buyer is looked up *before* the transaction (through the `IdentityApi` and `ProfileApi` contracts; a failure costs the name, not the top-up). Numbers are `INV-2026-000001`, `RCT-…`, `CN-…`: consecutive per kind and year, taken from a counter row that is locked until the document is stored (so there are no gaps, and documents of one kind are issued one transaction after the other). Read with `GET /billing/documents` (filter by `kind` or `topUpId`, cursor paging) and `GET /billing/documents/:id`; the web app renders a printable page for each (the browser saves it as a PDF). No tax is computed: the amount is the total. Erasing an account keeps the documents but sets `user_id` to null and blanks the buyer (name, email, address, tax id); the seller, number and amount stay. A user's data export includes their documents.
- **Locally**, `bun run dev` also runs the Stripe CLI forwarding webhooks to the API when `STRIPE_SECRET_KEY` is set (`scripts/stripe.ts`: the `stripe` binary if installed, the `stripe-cli` compose service otherwise); `bun run stripe:secret` prints the signing secret for `STRIPE_WEBHOOK_SECRET`, and `bun run test:stripe` pays with Stripe's test cards against the running stack.

## Languages (i18n)

Supported languages live in one place, `packages/shared-types/src/i18n.ts` (`LOCALES`, default `en`). Adding one = a locale there, a catalog next to each of the two catalogs below, and the registration line in each `index`.

- **Web** (`apps/web/src/i18n`): i18next + react-i18next, catalogs in `locales/<lang>.ts` with typed keys (`t('profile.title')` fails to compile when mistyped). The language is the saved choice, else the browser's, else English; the header switcher changes it, and every API request carries it as `Accept-Language`. The API's error `code` is translated by the web (`errors.<code>`), falling back to the server's English message for a code it does not know.
- **Account language** (`identity.users.locale`, `PUT /api/account/locale`, returned by `GET /api/me`): what mail and notifications are written in. A new account starts with the language of the browser that created it; signing in adopts the account's language in the app. Picking a language while signed in saves it on the account.
- **In-app notifications** store what their text is made from, not the text: a `template` (e.g. `passkeyAdded`) plus raw `data` (a name, a provider id, an ISO date, a user agent). The web app writes the message from `notifications.templates.<name>` in its catalog, so changing language also changes notifications that already exist. A custom notification has no template and keeps its text in `title`/`body`; so does a row from before templates, or a template this web build does not know. Adding a template = a key in `in-app-notifications.ts` (`TEMPLATES`, which also fills it for Web Push), its entry in both web catalogs, and a line in `features/notifications/text.ts`.
- **Web Push** leaves the app as text, so the server writes it at send time from the same template and data, in the account's language at that moment (`renderNotification`).
- **Mail** (`notification/application/messages`): written server-side in the recipient's language, because it leaves the request. Which language: the event's own `locale` when it carries one (a magic link follows the page that asked for it; the privacy events carry the account's language, and the deletion ledger keeps it for the goodbye mail sent after the account is gone), else the account's, looked up through `IdentityApi` (`IdentityLocaleResolver`), else English.
- **Catalog parity**: `diffCatalogs` (shared-types) is run by a unit test on each side, so a missing key or a dropped `{{placeholder}}` fails CI.

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
Requeue is safe because the inbox blocks handlers that already finished, so nothing is sent twice. Privacy jobs that are waiting on a module: `privacy:list`, `privacy:resume` (see *Privacy*).

### Using Amazon SES

- **Quick way, no code**: SES has an SMTP interface. Set `SMTP_HOST=email-smtp.<region>.amazonaws.com`, `SMTP_PORT=587`, `SMTP_REQUIRE_TLS=true`, `SMTP_USER`/`SMTP_PASSWORD` (the SES SMTP credentials), and `MAIL_FROM` to a verified address.
  Set `MAIL_RATE_PER_SECOND` to the account's *maximum send rate* and `MAIL_DAILY_QUOTA` to its *24-hour sending quota* (sandbox: 1/second, 200/day). The `454` error is recognised as a rate limit; `554 Message rejected` (e.g. recipient not verified in the sandbox) is permanent.
- **Use the SES API (AWS SDK)** when you need a configuration set, tags or bounce tracking: write `SesMailer implements Mailer`, map `ThrottlingException`/`Maximum sending rate exceeded`/`Daily message quota exceeded` → `MailRateLimitedError`, and `MessageRejected`/`MailFromDomainNotVerified` → `MailPermanentError`; pass it to `createContainer(config, logger, { mailer })`. The bucket, deferral, expiry and dead-letter behaviour stay the same.
- SES bounces/complaints arrive via SNS: add an endpoint/handler that records bounced addresses and blocks resending (a suppression list) — not in the project yet.

## Testing and CI

| Level | Command | What it proves |
| --- | --- | --- |
| Domain + use cases | `bun run test` | Business rules and orchestration against in-memory fakes (`shared/testing/fakes.ts`) — no I/O, runs in milliseconds. Possible only because use cases depend on ports. Privacy's choreography runs here end to end with a hand-rolled relay, including a participant that "lives in another service" and one that fails or goes silent. |
| Architecture | `bun run check:arch` | The layer/module rules above, via dependency-cruiser. |
| API e2e | `bun run test:e2e` (api) | The real `buildApp` against real Postgres/S3/Mailpit: full flows, outbox retry and dead-letter, mail throttling, SSE, Web Push (with a fake push sender), privacy (a real zip from S3, erasure across modules, the jobs on the real tables). |
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
6. If it holds anything about a person: take part in privacy — give it a `DataExporter` and a `DataEraser` and wire the two shared handlers (`ExportUserDataHandler`, `EraseUserDataHandler`, see `shared/application/privacy.ts`), then add its name to the participant lists in `bootstrap/container.ts`. An account is not "deleted" until every listed module has confirmed, so a module that is missing from the list is a module whose data survives.
7. `bun run check:arch` — if it fails, a boundary was crossed.

## Deliberate trade-offs

- **Step-up is stateless, so it cannot be revoked**: a confirmed access token keeps its `auth_time` for the whole `STEP_UP_TTL` even if the user signs the device out meanwhile (same ≤ 15-minute caveat as below), and a refresh drops it — the user simply confirms again. A passkey is the strong method; the emailed code is only as strong as the mailbox, and either can be picked, so owning a passkey does not force it.
- **OAuth step-up is deliberately not offered**: the attacker who holds a victim's browser session usually also holds their Google/GitHub session, so a redirect through the provider proves nothing extra.
- **Challenge / state tables are written by unauthenticated calls** (`/auth/passkey/options`, `/auth/oauth/*/start`): rows are pruned an hour after expiry on the next insert, but there is no per-IP limit here the way the magic link has. Put a rate limit on `/api/auth/*` at the proxy if the API is exposed.
- **Erasure races with events already in flight.** Events about the user that were emitted before the erasure but are handled after it can write a stray row (a notification, a push subscription). Handlers are not made to check "was this user erased": the window is the relay's lag, and the same goes for a still-valid access token (≤ 15 minutes) that writes after its account is gone (`GET /me` is 404, but `POST /notifications/seen` would still insert a row). Closing it fully needs a tombstone per module; the cost was judged higher than a user-id-and-timestamp row.
- **Personal data lingers in outbox payloads until the relay's cleanup (7 days)** wherever a module did not erase it: the export link and the address in privacy's own events are erased with the account (privacy erases its published outbox rows), but an export link is valid for up to `PRIVACY_EXPORT_TTL` regardless, like the magic-link token below. The archive itself is deleted at expiry.
- **A completed deletion leaves a ledger row** (ids, timestamps, no address) as proof that the erasure happened. Dropping it is a retention decision, not a technical one.
- **The export is built in memory** (zip of JSON plus two images). Fine while the data per user is small; a module that can hold a lot per user should write several files and the assembler should stream.
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
5. **Deployment**: reuse the image, set a suitable `APP_ROLES` (`api`, `worker`) and mount only that module's routes/handlers in the new composition root.
6. **Privacy**: the new service still has to take part in the two jobs — consume `privacy.data_export_requested.v1` and `privacy.account_erasure_requested.v1`, and answer `<module>.data_exported.v1` / `<module>.user_data_erased.v1` (payloads in `privacy/contracts`). Nothing else changes: `privacy` keeps the module's name in its participant lists and does not care where the module runs. Two things to carry over: the service writes its export part to the **same bucket** under the `uploadPrefix` it is given (or `privacy` needs a transport for the bytes), and it must erase **idempotently** (the request is re-sent when it is slow). While the service is down a deletion waits, is re-sent, then stalls rather than completing — the right failure for "forget me". Keep it in the participant list until its data is really gone; removing it is what makes a deletion complete without it.
7. **Verify**: `check:arch` must stay clean (no module imports another module's internals); rerun e2e over the network (privacy's export and deletion included — they are the test that every module still answers).
