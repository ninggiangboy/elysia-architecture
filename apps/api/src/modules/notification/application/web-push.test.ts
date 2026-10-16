import { beforeEach, describe, expect, test } from 'bun:test'
import { IdentityEvents } from '#/modules/identity/contracts'
import type { InboxGuard, Log } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import { FakeClock, PassthroughUnitOfWork, SequentialIds } from '#/shared/testing/fakes'
import { NotificationEvents } from '../contracts'
import { InvalidPushSubscriptionError, PushSubscription } from '../domain/push-subscription'
import type { PushSubscriptionRepository } from '../domain/push-subscription-repository'
import { DropPushSubscriptionsHandler } from './handlers/drop-push-subscriptions-handler'
import { MAX_WEB_PUSH_AGE_MS, WebPushHandler } from './handlers/web-push-handler'
import type { PushMessage, PushOutcome, PushTarget, WebPushSender } from './ports'
import { SubscribeToPush, UnsubscribeFromPush } from './use-cases/push-subscriptions'

const ALICE = '00000000-0000-7000-8000-00000000a11c'
const BOB = '00000000-0000-7000-8000-0000000000b0'
const KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1',
  auth: 'tBHItJI5svbpez7KI4CCXg',
}
const endpoint = (n: number) => `https://push.example.com/send/${n}`

class InMemorySubscriptions implements PushSubscriptionRepository {
  rows: PushSubscription[] = []
  async upsert(s: PushSubscription) {
    const i = this.rows.findIndex((r) => r.endpoint === s.endpoint)
    if (i === -1) this.rows.push(s)
    else this.rows[i] = PushSubscription.restore({ ...s.props, id: this.rows[i]?.id ?? s.id })
  }
  async listByUser(userId: string) {
    return this.rows.filter((r) => r.props.userId === userId)
  }
  async deleteByEndpoint(userId: string, ep: string) {
    this.rows = this.rows.filter((r) => !(r.props.userId === userId && r.endpoint === ep))
  }
  async deleteBySession(userId: string, sessionId: string) {
    this.rows = this.rows.filter(
      (r) => !(r.props.userId === userId && r.props.sessionId === sessionId),
    )
  }
  async deleteById(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id)
  }
  async pruneOldest(userId: string, keep: number) {
    const mine = this.rows.filter((r) => r.props.userId === userId)
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - keep)).map((r) => r.id))
    this.rows = this.rows.filter((r) => !drop.has(r.id))
  }
}

class FakeSender implements WebPushSender {
  sent: { target: PushTarget; message: PushMessage }[] = []
  outcomes = new Map<string, PushOutcome>()
  async send(target: PushTarget, message: PushMessage) {
    this.sent.push({ target, message })
    return this.outcomes.get(target.endpoint) ?? 'delivered'
  }
}

class OncePerMessageInbox implements InboxGuard {
  private done = new Set<string>()
  async transactional(id: string, handler: string, fn: () => Promise<void>) {
    return this.afterSideEffect(id, handler, fn)
  }
  async afterSideEffect(id: string, handler: string, fn: () => Promise<void>) {
    const key = `${id}:${handler}`
    if (this.done.has(key)) return
    await fn()
    this.done.add(key)
  }
}

const log: Log = { info() {}, warn() {}, error() {} }

const sub = (userId: string, n: number, sessionId = `session-${n}`) =>
  PushSubscription.create({
    id: `id-${n}`,
    userId,
    sessionId,
    endpoint: endpoint(n),
    ...KEYS,
    userAgent: null,
    createdAt: new Date(),
  })

describe('PushSubscription', () => {
  const base = {
    id: 'x',
    userId: ALICE,
    sessionId: 'sid',
    ...KEYS,
    userAgent: null,
    createdAt: new Date(),
  }
  test('accepts a public https endpoint', () => {
    expect(PushSubscription.create({ ...base, endpoint: endpoint(1) }).endpoint).toBe(endpoint(1))
  })
  test.each([
    ['http://push.example.com/x', 'plain http'],
    ['https://127.0.0.1/x', 'loopback IP'],
    ['https://[::1]/x', 'IPv6 literal'],
    ['https://10.0.0.5/x', 'private IP'],
    ['https://localhost/x', 'localhost'],
    ['https://db.internal/x', '.internal host'],
    ['https://user:pw@push.example.com/x', 'credentials in the URL'],
    ['not a url', 'garbage'],
    [`https://push.example.com/${'a'.repeat(2100)}`, 'oversized'],
  ])('rejects %s (%s)', (ep) => {
    expect(() => PushSubscription.create({ ...base, endpoint: ep })).toThrow(
      InvalidPushSubscriptionError,
    )
  })
  test('rejects malformed keys', () => {
    expect(() =>
      PushSubscription.create({
        ...base,
        endpoint: endpoint(1),
        p256dh: 'not base64!',
        auth: KEYS.auth,
      }),
    ).toThrow(InvalidPushSubscriptionError)
    expect(() =>
      PushSubscription.create({ ...base, endpoint: endpoint(1), p256dh: KEYS.p256dh, auth: '' }),
    ).toThrow(InvalidPushSubscriptionError)
  })
})

describe('SubscribeToPush / UnsubscribeFromPush', () => {
  let repo: InMemorySubscriptions
  let subscribe: SubscribeToPush
  const cmd = (userId: string, n: number) => ({
    userId,
    sessionId: `session-${n}`,
    endpoint: endpoint(n),
    ...KEYS,
    userAgent: 'UA',
  })
  beforeEach(() => {
    repo = new InMemorySubscriptions()
    subscribe = new SubscribeToPush(
      repo,
      new PassthroughUnitOfWork(),
      new SequentialIds(),
      new FakeClock(),
    )
  })

  test('is idempotent per endpoint', async () => {
    await subscribe.execute(cmd(ALICE, 1))
    await subscribe.execute(cmd(ALICE, 1))
    expect(await repo.listByUser(ALICE)).toHaveLength(1)
  })
  test('moves a browser to the account that signed in on it', async () => {
    await subscribe.execute(cmd(ALICE, 1))
    await subscribe.execute(cmd(BOB, 1))
    expect(await repo.listByUser(ALICE)).toHaveLength(0)
    expect(await repo.listByUser(BOB)).toHaveLength(1)
  })
  test('keeps only the newest 10 subscriptions per user', async () => {
    for (let n = 1; n <= 12; n++) await subscribe.execute(cmd(ALICE, n))
    const endpoints = (await repo.listByUser(ALICE)).map((s) => s.endpoint)
    expect(endpoints).toHaveLength(10)
    expect(endpoints).not.toContain(endpoint(1))
    expect(endpoints).toContain(endpoint(12))
  })
  test('rejects an unsafe endpoint', async () => {
    await expect(
      subscribe.execute({ ...cmd(ALICE, 1), endpoint: 'https://127.0.0.1/x' }),
    ).rejects.toThrow(InvalidPushSubscriptionError)
  })
  test('unsubscribing only affects the caller and tolerates unknown endpoints', async () => {
    await subscribe.execute(cmd(ALICE, 1))
    const unsubscribe = new UnsubscribeFromPush(repo)
    await unsubscribe.execute({ userId: BOB, endpoint: endpoint(1) })
    expect(await repo.listByUser(ALICE)).toHaveLength(1)
    await unsubscribe.execute({ userId: ALICE, endpoint: endpoint(1) })
    await unsubscribe.execute({ userId: ALICE, endpoint: endpoint(99) })
    expect(await repo.listByUser(ALICE)).toHaveLength(0)
  })
})

describe('WebPushHandler', () => {
  let repo: InMemorySubscriptions
  let sender: FakeSender
  let clock: FakeClock
  let handler: WebPushHandler
  const created = (over: Record<string, unknown> = {}, occurredAt = clock.now()): Envelope => ({
    id: `msg-${Math.random()}`,
    type: NotificationEvents.Created,
    source: 'notification',
    aggregateId: ALICE,
    occurredAt: occurredAt.toISOString(),
    payload: {
      notificationId: 'n-1',
      userId: ALICE,
      kind: 'welcome',
      title: 'Welcome aboard',
      body: 'Your account is ready.',
      data: { link: '/profile' },
      createdAt: clock.now().toISOString(),
      ...over,
    },
    headers: {},
  })
  beforeEach(() => {
    repo = new InMemorySubscriptions()
    sender = new FakeSender()
    clock = new FakeClock()
    handler = new WebPushHandler(repo, sender, new OncePerMessageInbox(), clock, log)
  })

  test('pushes to every browser of the user and to nobody else', async () => {
    repo.rows.push(sub(ALICE, 1), sub(ALICE, 2), sub(BOB, 3))
    await handler.handle(created())
    expect(sender.sent.map((s) => s.target.endpoint).sort()).toEqual([endpoint(1), endpoint(2)])
    expect(sender.sent[0]?.message).toEqual({
      id: 'n-1',
      title: 'Welcome aboard',
      body: 'Your account is ready.',
      link: '/profile',
    })
  })
  test('does nothing for a user without subscriptions', async () => {
    await handler.handle(created())
    expect(sender.sent).toHaveLength(0)
  })
  test('only opens in-app links, defaulting to the notifications page', async () => {
    repo.rows.push(sub(ALICE, 1))
    await handler.handle(created({ data: { link: 'https://evil.example/phish' } }))
    await handler.handle(created({ data: {} }))
    expect(sender.sent.map((s) => s.message.link)).toEqual(['/notifications', '/notifications'])
  })
  test('deletes a subscription the push service reports gone', async () => {
    repo.rows.push(sub(ALICE, 1), sub(ALICE, 2))
    sender.outcomes.set(endpoint(1), 'gone')
    await handler.handle(created())
    expect((await repo.listByUser(ALICE)).map((s) => s.endpoint)).toEqual([endpoint(2)])
  })
  test('keeps a subscription whose message was rejected, without failing', async () => {
    repo.rows.push(sub(ALICE, 1))
    sender.outcomes.set(endpoint(1), 'rejected')
    await handler.handle(created())
    expect(await repo.listByUser(ALICE)).toHaveLength(1)
  })
  test('rethrows when the push service is unavailable so the relay retries', async () => {
    repo.rows.push(sub(ALICE, 1), sub(ALICE, 2))
    sender.outcomes.set(endpoint(1), 'retry')
    const message = created()
    await expect(handler.handle(message)).rejects.toThrow()
    sender.outcomes.clear()
    await handler.handle(message)
    expect(sender.sent.filter((s) => s.target.endpoint === endpoint(1))).toHaveLength(2)
  })
  test('a delivered message is not pushed again when it is redelivered', async () => {
    repo.rows.push(sub(ALICE, 1))
    const message = created()
    await handler.handle(message)
    await handler.handle(message)
    expect(sender.sent).toHaveLength(1)
  })
  test('drops a push that is too old to matter', async () => {
    repo.rows.push(sub(ALICE, 1))
    await handler.handle(created({}, new Date(clock.now().getTime() - MAX_WEB_PUSH_AGE_MS - 1)))
    expect(sender.sent).toHaveLength(0)
  })
})

describe('DropPushSubscriptionsHandler', () => {
  const revoked = (userId: string, sessionId: string): Envelope => ({
    id: 'm1',
    type: IdentityEvents.SessionRevoked,
    source: 'identity',
    aggregateId: userId,
    occurredAt: new Date().toISOString(),
    payload: { userId, sessionId, reason: 'revoked_by_user', revokedAt: new Date().toISOString() },
    headers: {},
  })
  test('drops only the subscriptions of the revoked session', async () => {
    const repo = new InMemorySubscriptions()
    repo.rows.push(sub(ALICE, 1, 'phone'), sub(ALICE, 2, 'laptop'), sub(BOB, 3, 'phone'))
    await new DropPushSubscriptionsHandler(repo).handle(revoked(ALICE, 'phone'))
    expect(repo.rows.map((r) => r.endpoint)).toEqual([endpoint(2), endpoint(3)])
  })
})
