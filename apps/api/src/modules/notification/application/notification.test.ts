import { beforeEach, describe, expect, test } from 'bun:test'
import { IdentityEvents } from '#/modules/identity/contracts'
import type { InboxGuard } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import {
  FakeClock,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing/fakes'
import { NotificationEvents } from '../contracts'
import { InvalidNotificationError, Notification } from '../domain/notification'
import type { ListQuery, NotificationRepository } from '../domain/notification-repository'
import { CreateNotificationHandler } from './handlers/create-notification-handler'
import {
  describeDevice,
  newSignInNotification,
  suspiciousSessionNotification,
} from './in-app-notifications'
import { MarkAllNotificationsRead, MarkNotificationRead } from './use-cases/mark-read'
import { GetUnreadCount, ListNotifications } from './use-cases/read-notifications'

class InMemoryNotifications implements NotificationRepository {
  rows: Notification[] = []
  async insert(n: Notification) {
    this.rows.push(n)
  }
  async list(q: ListQuery) {
    return this.rows
      .filter((n) => n.userId === q.userId)
      .filter((n) => !q.before || n.id < q.before)
      .filter((n) => !q.unreadOnly || n.props.readAt === null)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, q.limit)
  }
  async countUnread(userId: string) {
    return this.rows.filter((n) => n.userId === userId && n.props.readAt === null).length
  }
  async markRead(userId: string, id: string, now: Date) {
    const n = this.rows.find((r) => r.id === id && r.userId === userId)
    if (!n) return 'not_found' as const
    if (n.props.readAt) return 'already_read' as const
    n.props.readAt = now
    return 'marked' as const
  }
  async markAllRead(userId: string, now: Date) {
    const unread = this.rows.filter((n) => n.userId === userId && n.props.readAt === null)
    for (const n of unread) n.props.readAt = now
    return unread.length
  }
}

/** Runs `fn` once per (messageId, handler), like the real inbox. */
class InMemoryInbox implements InboxGuard {
  private seen = new Set<string>()
  async transactional(messageId: string, handler: string, fn: () => Promise<void>) {
    const key = `${messageId}:${handler}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    await fn()
  }
  async afterSideEffect(messageId: string, handler: string, fn: () => Promise<void>) {
    return this.transactional(messageId, handler, fn)
  }
}

const envelope = (id: string, payload: Record<string, unknown>): Envelope => ({
  id,
  type: 'x.y.v1',
  source: 'identity',
  aggregateId: 'u',
  occurredAt: new Date().toISOString(),
  payload,
  headers: {},
})

const ALICE = '00000000-0000-7000-8000-00000000a11c'
const BOB = '00000000-0000-7000-8000-0000000000b0'

describe('Notification', () => {
  const base = {
    id: 'n1',
    userId: ALICE,
    kind: 'welcome' as const,
    title: 'Hi',
    body: '',
    data: {},
    createdAt: new Date(),
  }
  test('trims and starts unread', () => {
    const n = Notification.create({ ...base, title: '  Hi  ' })
    expect(n.props.title).toBe('Hi')
    expect(n.props.readAt).toBeNull()
  })
  test('rejects an empty or oversized title and an oversized body', () => {
    expect(() => Notification.create({ ...base, title: '  ' })).toThrow(InvalidNotificationError)
    expect(() => Notification.create({ ...base, title: 'x'.repeat(201) })).toThrow(
      InvalidNotificationError,
    )
    expect(() => Notification.create({ ...base, body: 'x'.repeat(1001) })).toThrow(
      InvalidNotificationError,
    )
  })
})

describe('CreateNotificationHandler', () => {
  let repo: InMemoryNotifications
  let outbox: InMemoryOutbox
  let handler: CreateNotificationHandler<{ userId: string; reason: string }>
  beforeEach(() => {
    repo = new InMemoryNotifications()
    outbox = new InMemoryOutbox()
    handler = new CreateNotificationHandler(
      'test.handler',
      IdentityEvents.SessionRevoked,
      (p) => (p.reason === 'token_reuse' ? suspiciousSessionNotification(p) : null),
      repo,
      outbox,
      new InMemoryInbox(),
      new SequentialIds(),
      new FakeClock(),
    )
  })

  test('stores the notification and announces it through the outbox', async () => {
    await handler.handle(envelope('m1', { userId: ALICE, reason: 'token_reuse' }))
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]?.props).toMatchObject({ userId: ALICE, kind: 'security_alert' })
    expect(outbox.types()).toEqual([NotificationEvents.Created])
    expect(outbox.events[0]?.aggregateId).toBe(ALICE)
    expect(outbox.events[0]?.payload).toMatchObject({ userId: ALICE, kind: 'security_alert' })
  })

  test('a redelivered event does not create a second notification', async () => {
    const message = envelope('m1', { userId: ALICE, reason: 'token_reuse' })
    await handler.handle(message)
    await handler.handle(message)
    expect(repo.rows).toHaveLength(1)
    expect(outbox.events).toHaveLength(1)
  })

  test('an event that is not worth a notification creates nothing', async () => {
    await handler.handle(envelope('m1', { userId: ALICE, reason: 'logout' }))
    expect(repo.rows).toHaveLength(0)
    expect(outbox.events).toHaveLength(0)
  })
})

describe('reading notifications', () => {
  let repo: InMemoryNotifications
  let outbox: InMemoryOutbox
  let clock: FakeClock
  let ids: SequentialIds
  const add = async (userId: string, title = 'n') => {
    const n = Notification.create({
      id: ids.next(),
      userId,
      kind: 'welcome',
      title,
      body: '',
      data: {},
      createdAt: clock.now(),
    })
    await repo.insert(n)
    return n
  }
  beforeEach(() => {
    repo = new InMemoryNotifications()
    outbox = new InMemoryOutbox()
    clock = new FakeClock()
    ids = new SequentialIds()
  })

  test('lists newest first and pages with a cursor', async () => {
    const [a, b, c] = [await add(ALICE, 'a'), await add(ALICE, 'b'), await add(ALICE, 'c')]
    await add(BOB, 'not mine')
    const list = new ListNotifications(repo)

    const first = await list.execute({ userId: ALICE, limit: 2 })
    expect(first.items.map((i) => i.id)).toEqual([c?.id, b?.id])
    expect(first.nextCursor).toBe(b?.id as string)

    const second = await list.execute({ userId: ALICE, limit: 2, before: first.nextCursor ?? '' })
    expect(second.items.map((i) => i.id)).toEqual([a?.id])
    expect(second.nextCursor).toBeNull()
  })

  test('clamps the page size', async () => {
    for (let i = 0; i < 60; i++) await add(ALICE)
    const page = await new ListNotifications(repo).execute({ userId: ALICE, limit: 500 })
    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).not.toBeNull()
  })

  test('counts only my unread notifications', async () => {
    const mine = await add(ALICE)
    await add(ALICE)
    await add(BOB)
    await repo.markRead(ALICE, mine.id, clock.now())
    expect(await new GetUnreadCount(repo).execute({ userId: ALICE })).toEqual({ count: 1 })
  })

  describe('MarkNotificationRead', () => {
    const useCase = () => new MarkNotificationRead(repo, outbox, new PassthroughUnitOfWork(), clock)

    test('marks read and tells the other devices', async () => {
      const n = await add(ALICE)
      await useCase().execute({ userId: ALICE, notificationId: n.id })
      expect(n.props.readAt).toEqual(clock.now())
      expect(outbox.types()).toEqual([NotificationEvents.Read])
      expect(outbox.events[0]?.payload).toMatchObject({ userId: ALICE, notificationId: n.id })
    })

    test('is idempotent: a second call succeeds and emits nothing more', async () => {
      const n = await add(ALICE)
      await useCase().execute({ userId: ALICE, notificationId: n.id })
      await useCase().execute({ userId: ALICE, notificationId: n.id })
      expect(outbox.events).toHaveLength(1)
    })

    test("someone else's notification looks like it does not exist", async () => {
      const n = await add(BOB)
      const err = await useCase()
        .execute({ userId: ALICE, notificationId: n.id })
        .catch((e) => e)
      expect(err).toMatchObject({ code: 'notification_not_found', kind: 'not_found' })
      expect(n.props.readAt).toBeNull()
    })
  })

  describe('MarkAllNotificationsRead', () => {
    const useCase = () =>
      new MarkAllNotificationsRead(repo, outbox, new PassthroughUnitOfWork(), clock)

    test('marks only my unread ones and emits a single event', async () => {
      await add(ALICE)
      await add(ALICE)
      const theirs = await add(BOB)
      expect(await useCase().execute({ userId: ALICE })).toEqual({ updated: 2 })
      expect(theirs.props.readAt).toBeNull()
      expect(outbox.events).toHaveLength(1)
      expect(outbox.events[0]?.payload).toMatchObject({ userId: ALICE, notificationId: null })
    })

    test('emits nothing when there is nothing to mark', async () => {
      expect(await useCase().execute({ userId: ALICE })).toEqual({ updated: 0 })
      expect(outbox.events).toHaveLength(0)
    })
  })
})

describe('new sign-in notification', () => {
  const chromeMac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

  test('describes the device and keeps the session for the client', () => {
    const draft = newSignInNotification({
      userId: ALICE,
      sessionId: 's1',
      ip: '203.0.113.9',
      userAgent: chromeMac,
    })
    expect(draft).toMatchObject({ userId: ALICE, kind: 'new_sign_in' })
    expect(draft.body).toContain('Chrome on macOS')
    expect(draft.body).toContain('203.0.113.9')
    expect(draft.data).toMatchObject({ sessionId: 's1' })
  })

  test('copes with a missing user agent and ip', () => {
    expect(describeDevice(null)).toBe('an unknown device')
    const draft = newSignInNotification({
      userId: ALICE,
      sessionId: 's1',
      ip: null,
      userAgent: null,
    })
    expect(draft.body).toStartWith('an unknown device signed in')
  })
})
