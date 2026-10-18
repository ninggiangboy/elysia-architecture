# @mod/privacy

## Purpose

Data export (a ZIP of what each module holds about you) and account deletion (a grace period, then a choreographed erasure across modules) for GDPR-style requests.

## Install

```bash
bun add @mod/privacy
bun run kit:add privacy        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: `@mod/identity`.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/privacy/contracts` only.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `PRIVACY_DELETION_GRACE_PERIOD` | `14d` | Account deletion: time between asking and the erasure starting. The user can cancel in between. |
| `PRIVACY_EXPORT_TTL` | `7d` | How long a finished data export can be downloaded. At most 7d: the longest an S3 presigned link can live. |
| `PRIVACY_JOBS_INTERVAL_SECONDS` | `30` | How often the jobs look for deletions whose grace period ended, silent modules and expired exports. |
| `PRIVACY_STALL_AFTER` | `10m` | A data export or an erasure with no progress for this long is re-sent to the modules that have not answered. |
| `PRIVACY_MAX_NUDGES` | `5` | Re-sends before giving up: an export then fails, an erasure waits for an operator (`privacy:resume`). |
<!-- config:end -->

## Tables and migrations

Schema `privacy`: data exports, account deletions and their per-module progress, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/privacy/manifest`).

## Events

`privacy.data_export_requested.v1` … `privacy.account_deleted.v1` (see `contracts`). The two request events are the protocol in `@kit/privacy-participant`.

## Wiring

```ts
const privacy = use(installPrivacy({ ...host, modules: { identity },
  participants: { exports: participants('exports'), erases: participants('erases') } }))
```

## Extension points

The participants (what the other modules declare), the config slice (grace period, link lifetime, nudges), integrations it ships (mails, in-app messages, live progress), and an operator CLI for stalled deletions.

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/privacy`, rename it `@app/privacy`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

A stalled job is re-sent to the modules that have not answered and, after the nudges, left for an operator; the archive link never appears in the replayable realtime buffer.

## Limits

Install it after the modules that take part; they do not import it.

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)
