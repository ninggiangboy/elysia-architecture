# @kit/db

## Purpose

One Postgres pool with an ambient transaction (`Database.run` / `.executor`), advisory locks, per-module migrations and the helpers that tell a unique violation from other errors.

## Install

```bash
bun add @kit/db
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Implements `UnitOfWork` (from `@kit/core`) with `Database`.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | **required** | Connection string. |
| `DB_POOL_MAX` | `10` | Pool size. Per process: Postgres sees APP_PROCESSES × DB_POOL_MAX connections per instance. |
| `DB_PREPARE` | `true` | Use prepared statements. Turn off behind a transaction-mode pooler (PgBouncer). |
<!-- config:end -->

## Tables and migrations

None of its own. `migrateModule` keeps each module's history in schema `drizzle_<module>`, table `__migrations`.

## Wiring

```ts
import { Database } from '@kit/db'

const database = new Database({ url, poolMax: 10, prepare: true })
await database.run(async () => {
  // every repository using database.executor now shares one transaction
})
```

## Guarantees

A nested `run` joins the outer transaction. `withAdvisoryXactLock(database, key, fn)` runs `fn` on one instance at a time and returns `undefined` on the others.

## Limits

One pool for all modules (modules differ by Postgres schema). A transaction-mode pooler needs `DB_PREPARE=false`.

## Related

[Ambient transaction](../../docs/patterns/ambient-transaction-async-local-storage.md) · [Singleton work in a cluster](../../docs/patterns/singleton-work-in-a-cluster.md)
