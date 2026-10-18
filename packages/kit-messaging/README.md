# @kit/messaging

## Purpose

The transactional outbox and the idempotent inbox: event envelope, outbox and inbox tables for any module schema, the writer, the relay (SKIP LOCKED, leases, backoff, dead letters), the in-process bus and `RetryLaterError`.

## Install

```bash
bun add @kit/messaging
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `OutboxWriter`, `InboxGuard`, `MessagePublisher`, `IntegrationEventHandler`. Implements them with Drizzle (`DrizzleOutboxWriter`, `DrizzleInboxGuard`) and an in-process bus.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | How often the relay looks for new messages. |
| `OUTBOX_BATCH_SIZE` | `200` | Messages claimed per relay batch. |
| `OUTBOX_CONCURRENCY` | `8` | Aggregates processed in parallel per batch; keep below DB_POOL_MAX. Messages of one aggregate stay ordered. |
| `OUTBOX_LEASE_SECONDS` | `30` | How long a claimed message stays reserved for this relay. Past it another relay may take it, so keep it above the slowest handler (image processing). |
| `OUTBOX_DEFER_BUDGET_HOURS` | `24` | Maximum time a message may be deferred by a rate limit (mail) before it is considered dead. |
<!-- config:end -->

## Tables and migrations

`outboxTable(schema)` and `inboxTable(schema)` create one `outbox_messages` and one `inbox` table in the schema you pass; the tables live in each module's own schema and migrations. If a column changes, run `db:generate` in every module.

## Wiring

```ts
import { DrizzleInboxGuard, DrizzleOutboxWriter, inboxTable, outboxTable } from '@kit/messaging'

const outbox = outboxTable(mySchema)
const writer = new DrizzleOutboxWriter(database, outbox, () => ids.next())
await database.run(async () => {
  await repo.save(order)
  await writer.add([{ type: 'orders.placed.v1', aggregateId: order.id, payload, occurredAt }])
})
```

## Guarantees

At-least-once delivery: handlers must be idempotent (`InboxGuard.transactional` makes a database effect exactly-once; `afterSideEffect` is at-least-once for external effects). Messages of one aggregate stay ordered.

## Limits

One transport today (in-process); the `MessagePublisher` port is where a broker plugs in.

## Related

[Transactional outbox](../../docs/patterns/transactional-outbox.md) · [Idempotent consumer](../../docs/patterns/idempotent-consumer-inbox.md) · [SKIP LOCKED](../../docs/patterns/skip-locked-work-claiming.md) · [Retry-later](../../docs/patterns/retry-later-deferral.md)
