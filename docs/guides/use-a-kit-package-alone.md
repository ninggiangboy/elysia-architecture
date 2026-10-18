# Use a kit package alone: the outbox in an existing Elysia app

You do not need the modules to use the kit. `@kit/messaging` is the transactional outbox, the idempotent inbox and a relay, and works in any Elysia + Drizzle + Postgres app. This guide adds it to an app that has one table and one route.

← [Architecture overview](../architecture.md)

## 1. Tables

The outbox and inbox are ordinary tables in a schema of yours:

```ts
// db/schema.ts
import { inboxTable, outboxTable } from '@kit/messaging'
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core'

export const shop = pgSchema('shop')
export const orders = shop.table('orders', { id: uuid('id').primaryKey(), userId: uuid('user_id').notNull(), status: text('status').notNull() })
export const outbox = outboxTable(shop)
export const inbox = inboxTable(shop)
```

Generate and apply the migration with your usual drizzle-kit setup. (If a future version of the package changes a column, the changelog says "run `db:generate`".)

## 2. Write the event in the same transaction

```ts
import { Database } from '@kit/db'
import { DrizzleOutboxWriter } from '@kit/messaging'
import { UuidV7Generator } from '@kit/core'

const database = new Database({ url: process.env.DATABASE_URL!, poolMax: 10, prepare: true })
const ids = new UuidV7Generator()
const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())

async function placeOrder(userId: string) {
  await database.run(async () => {                       // one transaction, ambient
    const id = ids.next()
    await database.executor.insert(orders).values({ id, userId, status: 'placed' })
    await outboxWriter.add([{ type: 'shop.order_placed.v1', aggregateId: id, payload: { orderId: id, userId }, occurredAt: new Date() }])
  })
}
```

`add` outside `database.run` throws on purpose: an event written without its state change is the bug the outbox exists to prevent.

## 3. Handle it, idempotently

```ts
import { DrizzleInboxGuard, InProcessMessageBus, OutboxRelay, type IntegrationEventHandler } from '@kit/messaging'
import { createLogger } from '@kit/telemetry'

const logger = createLogger('info')
const inboxGuard = new DrizzleInboxGuard(database, inbox)

const sendReceipt: IntegrationEventHandler = {
  name: 'shop.send-receipt',                              // the consumer group and the inbox key
  eventType: 'shop.order_placed.v1',
  handle: (message) => inboxGuard.afterSideEffect(message.id, 'shop.send-receipt', async () => {
    // an external effect (mail, HTTP): at-least-once, so make it safe to repeat
  }),
}

const bus = new InProcessMessageBus(logger)
bus.subscribe(sendReceipt)
const relay = new OutboxRelay(database, [{ name: 'shop', table: outbox }], bus, logger, { pollIntervalMs: 1000 })
relay.start()
```

Use `inboxGuard.transactional(...)` instead when the effect is a write to your own database: it commits with the inbox record, which makes it exactly-once.

## 4. Stop cleanly

```ts
process.on('SIGTERM', async () => { await relay.stop(); await database.close(); process.exit(0) })
```

The relay claims rows with `FOR UPDATE SKIP LOCKED` and a lease, so you can run it in every instance, or only in a worker. A handler that throws is retried with backoff and ends in the dead-letter state after the attempts; `RetryLaterError` defers without spending an attempt (rate limits).

## What you did not need

No broker, no Redis and none of the modules. If you later want sign-in, mail or billing, install the module and `kit:add` it; the outbox you already have is the same one they use.

## Test it with the same suites

```ts
import { describeInboxGuard, describeOutboxWriter } from '@kit/testing/contracts'
```

run on your tables prove the writer and guard behave like the fakes the kit's own tests use (see `apps/api/tests/integration/ports.integration.test.ts`).
