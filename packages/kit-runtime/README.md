# @kit/runtime

## Purpose

What runs the installed modules: `AppModule` and `ModuleManifest`, `ModuleHost`, `createRuntime` (bus, relay, maintenance, timers), health routes, interval jobs, the cluster supervisor and the `db` command-line.

## Install

```bash
bun add @kit/runtime
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `AppModule`, `ModuleHost`, `ModuleManifest`.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `MAINTENANCE_POLL_INTERVAL_MS` | `1000` | How often each process reads the maintenance flag; it takes this long to take effect. |
<!-- config:end -->

## Tables and migrations

`MaintenanceStore` keeps a one-row flag in `public.maintenance`; its migration is shipped by the app (`apps/api` today).

## Wiring

```ts
import { createRuntime } from '@kit/runtime'

const runtime = createRuntime({ modules: installed, database, logger, outbox: config.outbox,
  dbPoolMax: config.db.DB_POOL_MAX, maintenance: { pollIntervalMs: config.maintenance.MAINTENANCE_POLL_INTERVAL_MS } })
runtime.startWorker() // relay + every module's timers; follows maintenance mode
await runtime.close() // timers, relay, live connections, pool
```

## Guarantees

Maintenance mode stops the relay and the timers and resumes them when it ends, one transition at a time.

## Limits

Single-process lifecycle: cluster mode forks whole processes.

## Related

[Maintenance mode](../../docs/patterns/maintenance-mode-soft-deploy.md) · [Singleton work in a cluster](../../docs/patterns/singleton-work-in-a-cluster.md)
