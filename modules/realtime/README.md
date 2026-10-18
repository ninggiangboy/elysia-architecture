# @mod/realtime

## Purpose

Live updates over Server-Sent Events with a short replay buffer, delivered through Postgres LISTEN/NOTIFY so any API instance reaches any connection. It knows no producer: each module ships a `RealtimeIntegration`.

## Install

```bash
bun add @mod/realtime
bun run kit:add realtime        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: the kit; `@mod/identity` for the access-token verifier.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/realtime/contracts` only.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `REALTIME_REPLAY_WINDOW_SECONDS` | `900` | How long a disconnected SSE client can still replay the events that opted in (`session.revoked`) via `Last-Event-ID`. Keep it at least ACCESS_TOKEN_TTL: after that a device that missed its sign-out can no longer refresh its session anyway. |
<!-- config:end -->

## Tables and migrations

Schema `realtime`: a short-lived replay buffer. No outbox (nothing it does needs to be announced).

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/realtime/manifest`).

## Events

None.

## Wiring

```ts
const realtime = use(installRealtime({ ...host, modules: { identity },
  integrations: [identityRealtime, billingRealtime] }))
```

## Extension points

Integrations (the list passed to `install`) and the config slice (replay window).

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/realtime`, rename it `@app/realtime`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

Only events that opt in (`replay: true`) are stored; a reconnecting client resumes from its `Last-Event-ID`; the buffer of an erased account is purged.

## Limits

Delivery is best effort for events that do not replay: clients refetch their state on every `ready`.

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)
