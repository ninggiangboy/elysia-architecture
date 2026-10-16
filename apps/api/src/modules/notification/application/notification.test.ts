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
  type NotificationDraft,
  newSignInNotification,
  suspiciousSessionNotification,
} from './in-app-notifications'
import {
  MarkAllNotificationsRead,
  MarkNotificationRead,
  MarkNotificationsSeen,
} from './use-cases/mark-read'
import { GetUnreadCount, GetUnseenCount, ListNotifications } from './use-cases/read-notifications'

class InMemoryNotifications implements NotificationRepository {
  rows: Notification[] = []
  async insert(n: Notification) {
    this.rows.push(n)
  }
  async coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    now: Date,
    latest: Pick<Notification['props'], 'title' | 'body' | 'data'>,
  ) {
    const target = this.rows
      .filter(
        (n) =>
          n.userId === userId &&
          n.props.groupKey === groupKey &&
          n.props.readAt === null &&
          n.props.createdAt >= since,
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    if (!target) return null
    Object.assign(target.props, latest, { count: target.props.count + 1, notifiedAt: now })
    return target
  }
  async createdAtBefore(userId: string, id: string) {
    const previous = this.rows
      .filter((n) => n.userId === userId && n.id < id)
      .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    return previous?.props.createdAt ?? null
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
  seenAt = new Map<string, Date>()
  async countUnseen(userId: string) {
    const seen = this.seenAt.get(userId)
    return this.rows.filter(
      (n) => n.userId === userId && n.props.readAt === null && (!seen || n.props.notifiedAt > seen),
    ).length
  }
  async markSeen(userId: string, now: Date) {
    this.seenAt.set(userId, now)
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

describe('CreateNotificationHandler with a group', () => {
  const WINDOW_MS = 10 * 60_000
  // No real draft is grouped yet, so exercise the mechanism with the sign-in one.
  const grouped = (p: Parameters<typeof newSignInNotification>[0]): NotificationDraft => ({
    ...newSignInNotification(p),
    group: { key: 'new_sign_in', withinMs: WINDOW_MS },
  })
  const signIn = (n: number) =>
    envelope(`m${n}`, { userId: ALICE, sessionId: `s${n}`, ip: null, userAgent: `UA ${n}` })
  let repo: InMemoryNotifications
  let outbox: InMemoryOutbox
  let clock: FakeClock
  let handler: CreateNotificationHandler<Parameters<typeof newSignInNotification>[0]>
  beforeEach(() => {
    repo = new InMemoryNotifications()
    outbox = new InMemoryOutbox()
    clock = new FakeClock()
    handler = new CreateNotificationHandler(
      'test.sign-in',
      IdentityEvents.SessionStarted,
      grouped,
      repo,
      outbox,
      new InMemoryInbox(),
      new SequentialIds(),
      clock,
    )
  })

  test('a burst folds into one notification with a count, announced each time under the same id', async () => {
    for (const n of [1, 2, 3]) await handler.handle(signIn(n))
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]?.props).toMatchObject({ count: 3, groupKey: 'new_sign_in' })
    expect(repo.rows[0]?.props.data).toMatchObject({ sessionId: 's3' })
    const ids = outbox.events.map((e) => e.payload.notificationId)
    expect(ids).toEqual([repo.rows[0]?.id, repo.rows[0]?.id, repo.rows[0]?.id])
    expect(outbox.events.map((e) => e.payload.count)).toEqual([1, 2, 3])
  })

  test('a repeat folded into a notification that was already seen makes news again', async () => {
    await handler.handle(signIn(1))
    await repo.markSeen(ALICE, clock.now())
    expect(await repo.countUnseen(ALICE)).toBe(0)
    clock.advance(1000)
    await handler.handle(signIn(2))
    expect(repo.rows).toHaveLength(1)
    expect(await repo.countUnseen(ALICE)).toBe(1)
  })

  test('a redelivered event is not counted twice', async () => {
    await handler.handle(signIn(1))
    await handler.handle(signIn(2))
    await handler.handle(signIn(2))
    expect(repo.rows[0]?.props.count).toBe(2)
  })

  test('starts a new notification once the old one was read', async () => {
    await handler.handle(signIn(1))
    await repo.markRead(ALICE, repo.rows[0]?.id as string, clock.now())
    await handler.handle(signIn(2))
    expect(repo.rows).toHaveLength(2)
  })

  test('starts a new notification once the window has passed', async () => {
    await handler.handle(signIn(1))
    clock.advance(WINDOW_MS + 1)
    await handler.handle(signIn(2))
    expect(repo.rows).toHaveLength(2)
  })

  test('never folds across users', async () => {
    await handler.handle(signIn(1))
    await handler.handle(
      envelope('mb', { userId: BOB, sessionId: 'sb', ip: null, userAgent: null }),
    )
    expect(repo.rows).toHaveLength(2)
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

  describe('unseen (the badge) vs unread', () => {
    const seen = () => new MarkNotificationsSeen(repo, outbox, new PassthroughUnitOfWork(), clock)
    const unseen = async (userId = ALICE) =>
      (await new GetUnseenCount(repo).execute({ userId })).count

    test('opening the list zeroes the badge but leaves every notification unread', async () => {
      await add(ALICE)
      await add(ALICE)
      expect(await unseen()).toBe(2)
      await seen().execute({ userId: ALICE })
      expect(await unseen()).toBe(0)
      expect(await new GetUnreadCount(repo).execute({ userId: ALICE })).toEqual({ count: 2 })
    })

    test('only what arrives after the list was opened counts again', async () => {
      await add(ALICE)
      await seen().execute({ userId: ALICE })
      clock.advance(1000)
      await add(ALICE)
      expect(await unseen()).toBe(1)
    })

    test('a read notification never counts, even if it was never seen', async () => {
      const n = await add(ALICE)
      await repo.markRead(ALICE, n.id, clock.now())
      expect(await unseen()).toBe(0)
    })

    test('is per user', async () => {
      await add(ALICE)
      await add(BOB)
      await seen().execute({ userId: ALICE })
      expect(await unseen(ALICE)).toBe(0)
      expect(await unseen(BOB)).toBe(1)
    })

    test('tells the other devices only when the badge was showing something', async () => {
      await add(ALICE)
      await seen().execute({ userId: ALICE })
      await seen().execute({ userId: ALICE })
      expect(outbox.types()).toEqual([NotificationEvents.Seen])
      expect(outbox.events[0]?.payload).toMatchObject({ userId: ALICE })
    })
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
