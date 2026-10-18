import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { CreateNotificationHandler } from '#/modules/notification/application/handlers/create-notification-handler'
import type { NotificationDraft } from '#/modules/notification/contracts'
import { Notification } from '#/modules/notification/domain/notification'
import { DrizzleNotificationRepository } from '#/modules/notification/infrastructure/persistence/drizzle-notification-repository'
import {
  inbox,
  notifications,
  outbox,
} from '#/modules/notification/infrastructure/persistence/schema'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '#/shared/messaging'
import { createTestApp, type TestApp } from './helpers'

let t: TestApp
beforeAll(async () => {
  t = await createTestApp()
})
afterAll(async () => {
  await t.container.close()
})

const draft = (userId: string): NotificationDraft => ({
  userId,
  kind: 'welcome',
  title: 'Hi',
  body: '',
  data: {},
  group: { key: 'burst', withinMs: 60_000 },
})

describe('folding repeated notifications', () => {
  test('events racing on a group with no row yet still end up as ONE notification', async () => {
    const { database, ids, clock } = t.container
    const userId = Bun.randomUUIDv7()
    const handler = new CreateNotificationHandler<{ userId: string }>(
      'test.folding',
      'x.y.v1',
      (p) => draft(p.userId),
      new DrizzleNotificationRepository(database),
      new DrizzleOutboxWriter(database, outbox, () => ids.next()),
      new DrizzleInboxGuard(database, inbox),
      ids,
      clock,
    )
    const message = () => ({
      id: Bun.randomUUIDv7(),
      type: 'x.y.v1',
      source: 'test',
      aggregateId: userId,
      occurredAt: new Date().toISOString(),
      payload: { userId },
      headers: {},
    })

    await Promise.all(Array.from({ length: 8 }, () => handler.handle(message())))

    const rows = await database.executor
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
    await database.executor.delete(notifications).where(eq(notifications.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(8)
  })
})

describe('notification retention', () => {
  test('deletes what is past the retention and leaves recent notifications alone', async () => {
    const { database, clock, modules } = t.container
    const repo = new DrizzleNotificationRepository(database)
    const userId = Bun.randomUUIDv7()
    const ago = (days: number) => new Date(clock.now().getTime() - days * 86_400_000)
    const make = (createdAt: Date) =>
      Notification.create({
        id: Bun.randomUUIDv7(),
        userId,
        kind: 'welcome',
        title: 'Hi',
        body: '',
        data: {},
        createdAt,
      })
    const [old, fresh] = [
      make(ago(t.config.notification.NOTIFICATION_RETENTION / 86_400 + 1)),
      make(ago(1)),
    ]
    await repo.insert(old)
    await repo.insert(fresh)

    expect(await modules.notification.prune()).toBeGreaterThanOrEqual(1)

    const left = await database.executor
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, userId))
    await database.executor.delete(notifications).where(eq(notifications.userId, userId))
    expect(left.map((r) => r.id)).toEqual([fresh.id])
  })
})
