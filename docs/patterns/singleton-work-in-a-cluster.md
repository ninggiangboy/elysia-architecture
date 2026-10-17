# Singleton work in a cluster

← [Pattern catalog](README.md) · Category: Concurrency

## Problem

Some work should run in one place at a time:
- a cleanup;
- a deploy;
- per-user ordering of writes;
- a timer whose previous pass is still running.

With N stateless instances, and N processes per instance, there is no leader, and adding a coordinator (ZooKeeper, Redis locks) is a new moving part.

## When to use

You already run Postgres, and the work is either a periodic job or a critical section keyed by something (a user, a name).

## Solution

Use the tool that matches the scope of "one":

| Scope | Tool | Released when |
| --- | --- | --- |
| One instance does a periodic job; the others skip | `pg_try_advisory_xact_lock(hashtext(key))` | The transaction ends |
| One run of a long script cluster-wide (deploy) | `pg_try_advisory_lock(hashtext(key))` on a dedicated connection | The connection closes, so a crash cannot leave it behind |
| Serialise writes per key (one user's events) | `pg_advisory_xact_lock(hashtextextended(userId, 0))` (waits) | The transaction ends |
| One pass of a timer in this process | `running ??= job().finally(() => running = undefined)` | The pass ends |
| One role per node | Process slot: run the worker only in `PROCESS_SLOT === 0` | — |

## Implementation

**Try-lock and skip:**

```ts
export async function withAdvisoryXactLock<T>(database: Database, key: string, fn: () => Promise<T>) {
  return database.run(async () => {
    const rows = await database.executor.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`,
    )
    if (!rows[0]?.locked) return undefined   // someone else is doing it: skip, do not wait
    return fn()
  })
}
// relay cleanup, every 10 min per process, but one instance at a time per module
await withAdvisoryXactLock(this.database, `outbox-cleanup:${name}`, () => deleteOldPublished())
```

**Session lock for a deploy script** (one connection, `poolMax: 1`):

```ts
const [lock] = await database.db.execute(sql`select pg_try_advisory_lock(hashtext('deploy')) as ok`)
if (!lock?.ok) throw new DeployError('another deploy is running')
```

**Per-key ordering** (realtime replay: `seq` must be in commit order per user):

```ts
await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
const [row] = await tx.insert(events).values(...).returning({ seq: events.seq })
```

**Non-overlapping timers:**

```ts
let running: Promise<unknown> | undefined
const tick = () => { running ??= jobs.runOnce().finally(() => { running = undefined }) }
timer = setInterval(tick, intervalMs); timer.unref()
stopJobs = async () => { clearInterval(timer); await running }   // wait for the pass in flight
```

## Edge cases and pitfalls

- **`hashtext` is 32-bit**, so collisions between unrelated keys are possible. Prefix keys by purpose. `hashtextextended(key, 0)` is 64-bit.
- **Session advisory locks and PgBouncer** in transaction mode do not mix: the lock lands on whatever server connection you happened to get. Use xact locks there, or a direct connection.
- **Try vs wait.** Use *try* for jobs, because someone else doing it is as good as you doing it. Use *wait* only for short critical sections such as per-user ordering.
- **Timers.** `unref()` them so they do not keep the process alive, and make `stop` await the running pass, which is what lets graceful shutdown and maintenance mode drain cleanly.
- **Process slots** are a placement decision, not a correctness one. Here the relay is already safe on every process (`SKIP LOCKED`); slot 0 just avoids wasted polling.

## In this repo

- `apps/api/src/shared/infrastructure/db/advisory-lock.ts` (`withAdvisoryXactLock`)
- `OutboxRelay.maybeCleanup`
- `apps/api/scripts/deploy.ts` (`deploy()`)
- `PgRealtimeHub.publish`
- `privacy.module.ts` and `billing.module.ts` (`running ??=`)
- `main.ts` (slot 0)

## Reuse checklist

- [ ] Keys namespaced (`outbox-cleanup:<module>`)
- [ ] xact locks for jobs, session locks only on a dedicated direct connection
- [ ] Timers: `running ??=`, `unref`, and a stop that awaits
