# 13. Trade-offs and known gaps

**Trade-offs** are choices made on purpose, with the cost understood. **Known gaps** are places where the code does not yet do what it should, or what a comment or this documentation says. They were found while writing these docs, each one checked against the code. They are listed so that nobody copies them into another project by accident.

← [Architecture overview](../architecture.md)

## Deliberate trade-offs

### Security

- **Logout does not revoke the access token immediately.**
  - The token stays valid for up to 15 minutes, both for logout and for remote logout of a device.
  - Making it instant needs a denylist in a fast store (Redis), and the project deliberately avoids Redis.
  - Realtime softens it: the revoked device is told over SSE and signs itself out.
- **Step-up is stateless, so it cannot be revoked.**
  - A confirmed access token keeps its `auth_time` for the whole `STEP_UP_TTL`, even if the user signs the device out meanwhile (the same ≤ 15-minute caveat). A refresh drops it, and the user simply confirms again.
  - A passkey is the strong method. The emailed code is only as strong as the mailbox. Either can be picked, so owning a passkey does not force it.
- **OAuth step-up is not offered.** An attacker who holds a victim's browser session usually holds their Google/GitHub session too, so a redirect through the provider proves nothing extra.
- **Challenge and state tables are written by unauthenticated calls** (`/auth/passkey/options`, `/auth/oauth/*/start`). Rows are pruned an hour after expiry on the next insert, but there is no per-IP limit there the way the magic link has one. Put a rate limit on `/api/auth/*` at the proxy if the API is exposed.
- **The magic-link rate limit lives in Postgres** (3 per email, 10 per IP per 15 minutes). It is correct with many instances, but a few extra requests can slip through under a race. That is enough to stop spam; for something stricter, replace the adapter of the `MagicLinkThrottle` port.
- **`x-forwarded-for` is trusted** (first entry). That is only safe behind a reverse proxy you control; the nginx in compose sets it. Do not expose the API directly to the Internet while trusting this header.
- **Raw one-time tokens sit in the outbox until cleanup.** The magic-link token is in the payload until published messages are deleted after 7 days. For something stricter, encrypt the payload or wipe it right after publishing.

### Data and privacy

- **Erasure races with events already in flight.**
  - Events about the user emitted before the erasure but handled after it can write a stray row (a notification, a push subscription).
  - Handlers do not check "was this user erased"; the window is the relay's lag.
  - The same goes for a still-valid access token (≤ 15 minutes) writing after its account is gone: `GET /me` is a 404, but `POST /notifications/seen` would still insert a row.
  - Closing this fully needs a tombstone per module. That cost was judged higher than a stray row holding a user id and a timestamp.
- **Personal data lingers in outbox payloads until the relay's 7-day cleanup**, wherever a module did not erase it. Privacy erases its own published rows, including export links and addresses. An export link is still valid for up to `PRIVACY_EXPORT_TTL` regardless, like the magic-link token. The archive itself is deleted at expiry.
- **A completed deletion leaves a ledger row** (ids and timestamps, no address) as proof that the erasure happened. Dropping it is a retention decision, not a technical one.
- **Billing keeps financial records** after erasure, anonymised: `user_id` is null and the buyer is blanked.
- **The export is built in memory** (a zip of JSON plus two images). That is fine while the data per user is small. A module that can hold a lot per user should write several files, and the assembler should stream.

### Architecture

- **One pool and one shared transaction for all modules.** It is convenient and saves connections, but modules are not forced to isolate their transactions. When splitting services, review every place where a transaction spans several modules.
- **Synchronous cross-module calls** (`IdentityApi`) make `GET /me` depend on identity. When splitting services you need a timeout and a fallback. Today `GET /me` tolerates a *missing profile*, but not an identity outage.
- **One mail bucket for all mail types.** Important mail (a magic link) may queue behind welcome mail under load. If you need priority, split buckets by type (the limiter's `key`) or order by priority when claiming.
- **Gapless document numbers serialise issuing.** The counter row is locked until the money transaction commits, so documents of one kind are issued one transaction after the other. That is fine at this scale; at high volume, number documents in a separate, later step.
- **Per-aggregate order is best effort, not strict FIFO.** Messages of one aggregate never run at the same time and start in id order. But if one fails, the later ones still run, and it is retried after them. Blocking an aggregate behind a failing message would let one rate-limited mail hold up every other event about that user for up to the 24 h defer budget. So handlers must not depend on order; progress events carry counts, and state is re-read rather than inferred from sequence.
- **The SMTP penalty is a fixed 30 s.** SMTP has no standard "retry after" hint, so `classifySmtpError` cannot give one and `ThrottledMailer` puts the shared bucket in debt for its default. An API-based mailer (SES SDK) that returns a hint can pass `retryAfterMs` and the penalty follows it.
- **No Redis, no broker.** Postgres does the rate limits, fan-out, queues and locks. That is fewer moving parts, at the cost of LISTEN needing a direct connection and NOTIFY payloads being capped at 8 KB.

## Known gaps

None open at the moment.

When one of these is fixed, delete its row.

### Fixed after the review

Found while writing these docs and fixed in the same change, with tests:

- **The relay restores the request context.** Handlers log with the original `correlationId`, and their follow-up events carry it, with `causationId` = the message that caused them (`OutboxRelay.process`; e2e *the correlation id survives the relay*).
- **The claim uses one clock**, the database's `now()`, for due-ness, lease expiry and the lease itself (`OutboxRelay.drain`).
- **Step-up codes are stored as an HMAC** under `STEP_UP_CODE_SECRET`, not a plain SHA-256 (`TokenService.keyedHash`; `crypto.test.ts`).
- **`InMemoryInbox` simulates the crash window** between a side effect and the inbox write (`crashAfterNextSideEffect`; `fakes.test.ts`).
- **Notification folding is serialised per group** with an advisory lock, so racing events cannot insert two rows (e2e *notification-folding*, which fails without the lock).
- **Old notifications are deleted** by a retention job (`NOTIFICATION_RETENTION`, default 90d).
- **The outbox CLI knows `billing`**, and `requeue` clears `last_error` (`apps/api/scripts/outbox.ts`).
- **The `UnitOfWork` comment** now matches `Database`: a transaction *can* span modules, and by convention stays in one.
- **429 answers carry `Retry-After`**, computed from when the oldest counted request leaves the window (`TooManyRequestsError.retryAfterSeconds`, magic-link throttle, step-up codes).
- **A cross-tab refresh race no longer drops the cookie.** Inside the 10 s grace window, the refresh answers `401 refresh_token_rotated` without clearing the cookie, and the web client retries once after 300 ms.
- **Billing's `contracts/events.ts`** has the versioning header the other modules have.
- **Three e2e tests** expected notification links from before the settings reorganisation (`6f67260`): `/`, `/privacy`.
