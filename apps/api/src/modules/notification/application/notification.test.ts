import { beforeEach, describe, expect, test } from 'bun:test'
import type { Envelope, InboxGuard } from '#/shared/messaging'
import { FakeClock, InMemoryOutbox, PassthroughUnitOfWork, SequentialIds } from '#/shared/testing'
import { type NotificationDraft, NotificationEvents } from '../contracts'
import { InvalidNotificationError, Notification } from '../domain/notification'
import type { ListQuery, NotificationRepository } from '../domain/notification-repository'
import { CreateNotificationHandler } from './handlers/create-notification-handler'
import { createMessages } from './messages'
import { createNotificationRenderer } from './notification-renderer'
import { PruneOldNotifications } from './prune-notifications'
import {
  MarkAllNotificationsRead,
  MarkNotificationRead,
  MarkNotificationsSeen,
} from './use-cases/mark-read'
import { GetUnreadCount, GetUnseenCount, ListNotifications } from './use-cases/read-notifications'

// Producer-shaped drafts, local to the test: the notification module knows no producer.
const SESSION_REVOKED = 'test.session_revoked.v1'
const SESSION_STARTED = 'test.session_started.v1'
const suspiciousSessionNotification = (p: { userId: string }): NotificationDraft => ({
  userId: p.userId,
  kind: 'security_alert',
  template: 'suspiciousSession',
  data: { link: '/settings/security' },
})
const newSignInNotification = (p: {
  userId: string
  sessionId: string
  ip: string | null
  userAgent: string | null
}): NotificationDraft => ({
  userId: p.userId,
  kind: 'new_sign_in',
  template: 'newSignIn',
  data: { link: '/settings/security', sessionId: p.sessionId, ip: p.ip, userAgent: p.userAgent },
})

class InMemoryNotifications implements NotificationRepository {
  rows: Notification[] = []
  async insert(n: Notification) {
    this.rows.push(n)
  }
  locked: string[] = []
  async lockGroup(userId: string, groupKey: string) {
    this.locked.push(`${userId}:${groupKey}`)
  }
  async deleteCreatedBefore(cutoff: Date, limit: number) {
    const doomed = this.rows.filter((n) => n.props.createdAt < cutoff).slice(0, limit)
    this.rows = this.rows.filter((n) => !doomed.includes(n))
    return doomed.length
  }
  async coalesce(
    userId: string,
    groupKey: string,
    since: Date,
    now: Date,
    latest: Pick<Notification['props'], 'template' | 'title' | 'body' | 'data'>,
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
  async lastSeenAt(userId: string) {
    return this.seenAt.get(userId) ?? null
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
      SESSION_REVOKED,
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
      SESSION_STARTED,
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

  test('takes the group lock before looking for a row to fold into, and only for grouped drafts', async () => {
    await handler.handle(signIn(1))
    expect(repo.locked).toEqual([`${ALICE}:new_sign_in`])
    const plain = new CreateNotificationHandler(
      'test.plain',
      SESSION_STARTED,
      newSignInNotification,
      repo,
      outbox,
      new InMemoryInbox(),
      new SequentialIds(),
      clock,
    )
    await plain.handle(signIn(2))
    expect(repo.locked).toHaveLength(1)
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

describe('notification renderer', () => {
  const templates = {
    greeted: (d: Record<string, unknown>, { t }: { t: (key: string) => string }) => ({
      who: String(d.who ?? t('common.minutes')),
    }),
  }
  const integration = {
    templates,
    messages: {
      en: { inApp: { greeted: { title: 'Hello {{who}}', body: 'Nice to see {{who}}' } } },
      vi: { inApp: { greeted: { title: 'Chào {{who}}', body: 'Rất vui được gặp {{who}}' } } },
    },
  }
  const render = createNotificationRenderer(
    templates,
    createMessages({ integrations: [integration] }).translate,
  )

  test('writes a template in the reader language, from the data it was stored with', () => {
    expect(render('greeted', { who: 'Ann' }, 'en')).toEqual({
      title: 'Hello Ann',
      body: 'Nice to see Ann',
    })
    expect(render('greeted', { who: 'Ann' }, 'vi')?.title).toBe('Chào Ann')
  })

  test('answers null for a template this build does not know', () => {
    expect(render('somethingNew', {}, 'en')).toBeNull()
    expect(render('constructor', {}, 'en')).toBeNull()
  })
})

describe('PruneOldNotifications', () => {
  const DAY = 86_400_000
  const log = { info() {}, warn() {}, error() {} }
  const make = (id: string, createdAt: Date) =>
    Notification.create({
      id,
      userId: ALICE,
      kind: 'welcome',
      title: 'Hi',
      body: '',
      data: {},
      createdAt,
    })
  let repo: InMemoryNotifications
  let clock: FakeClock
  beforeEach(() => {
    repo = new InMemoryNotifications()
    clock = new FakeClock()
  })
  const pruner = (batchSize = 100) =>
    new PruneOldNotifications(repo, { maxAgeMs: 90 * DAY, batchSize }, clock, log)

  test('deletes what is past the retention, read or not, and keeps the rest', async () => {
    const now = clock.now().getTime()
    await repo.insert(make('old-unread', new Date(now - 91 * DAY)))
    const readOne = make('old-read', new Date(now - 100 * DAY))
    readOne.props.readAt = clock.now()
    await repo.insert(readOne)
    await repo.insert(make('edge', new Date(now - 90 * DAY)))
    await repo.insert(make('fresh', new Date(now - DAY)))
    expect(await pruner().runOnce()).toBe(2)
    expect(repo.rows.map((n) => n.id)).toEqual(['edge', 'fresh'])
  })

  test('works through a backlog in batches', async () => {
    const old = new Date(clock.now().getTime() - 120 * DAY)
    for (let i = 0; i < 7; i++) await repo.insert(make(`n${i}`, old))
    expect(await pruner(3).runOnce()).toBe(7)
    expect(repo.rows).toHaveLength(0)
  })

  test('has nothing to do on a clean table', async () => {
    expect(await pruner().runOnce()).toBe(0)
  })
})
