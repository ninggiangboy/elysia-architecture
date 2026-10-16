import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { decodeJwt } from 'jose'
import {
  client,
  createTestApp,
  eventually,
  login,
  openSse,
  type TestApp,
  uniqueEmail,
  waitForMail,
} from './helpers'

let t: TestApp
let api: ReturnType<typeof client>

beforeAll(async () => {
  t = await createTestApp()
  api = client(t.app)
})

afterAll(async () => {
  await t.container.close()
})

const unreadCount = async (token: string) =>
  (await api('GET', '/api/notifications/unread-count', { token })).json.count as number

/** A first sign-in (sign-up) produces just the welcome notification. */
const SIGN_UP_NOTIFICATIONS = 1
const untilSignedUpNotifications = (token: string) =>
  eventually(
    async () => (await unreadCount(token)) >= SIGN_UP_NOTIFICATIONS,
    10_000,
    'sign-up notifications',
  )

/** Signs in a brand-new user and waits until their sign-up notifications exist. */
async function signUp(tag: string) {
  const me = await login(api, uniqueEmail(tag))
  await untilSignedUpNotifications(me.accessToken)
  return me
}

describe('notifications', () => {
  test('requires a bearer token', async () => {
    expect((await api('GET', '/api/notifications')).status).toBe(401)
    expect((await api('GET', '/api/notifications/unread-count')).status).toBe(401)
  })

  test('a new user gets a welcome notification', async () => {
    const me = await signUp('welcome')
    const list = await api('GET', '/api/notifications', { token: me.accessToken })
    expect(list.status).toBe(200)
    expect(list.json.nextCursor).toBeNull()
    expect(list.json.items).toHaveLength(SIGN_UP_NOTIFICATIONS)
    expect(list.json.items[0]).toMatchObject({
      kind: 'welcome',
      read: false,
      readAt: null,
      data: { link: '/' },
    })
    expect(await unreadCount(me.accessToken)).toBe(SIGN_UP_NOTIFICATIONS)
  })

  test('signing in from another device is announced — but the first sign-in (sign-up) is not', async () => {
    const email = uniqueEmail('second-device')
    const laptop = await login(api, email, 'Laptop/1.0')
    await untilSignedUpNotifications(laptop.accessToken)
    const phone = await login(
      api,
      email,
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
    )
    const phoneSid = decodeJwt(phone.accessToken).sid

    const list = () => api('GET', '/api/notifications', { token: laptop.accessToken })
    const notice = await eventually(
      async () =>
        (await list()).json.items.find(
          (i: { data: { sessionId?: string } }) => i.data.sessionId === phoneSid,
        ),
      10_000,
      'notice for the second sign-in',
    )
    expect(notice).toMatchObject({ kind: 'new_sign_in', read: false })
    // Stored as what the text is made from: the client writes it, in the reader's language.
    expect(notice).toMatchObject({ template: 'newSignIn', title: '', body: '' })
    expect(notice.data.userAgent).toContain('iPhone')
    expect(notice.data).toMatchObject({ userAgent: expect.stringContaining('iPhone') })

    // Events are relayed in order, so the laptop's own (first) sign-in has been handled by now: only the welcome is there.
    const kinds = (await list()).json.items.map((i: { kind: string }) => i.kind)
    expect(kinds.sort()).toEqual(['new_sign_in', 'welcome'])
  })

  test('reading a notification is announced to the user’s other open devices', async () => {
    const email = uniqueEmail('live')
    const first = await login(api, email)
    await untilSignedUpNotifications(first.accessToken)
    const phone = await login(api, email, 'Phone/1.0')
    const stream = await openSse(t.app, phone.accessToken)
    try {
      await stream.next('ready')

      // Read it on the first device; the phone's stream is told so it can clear its badge.
      const id = (await api('GET', '/api/notifications', { token: first.accessToken })).json
        .items[0].id as string
      expect(
        (await api('POST', `/api/notifications/${id}/read`, { token: first.accessToken })).status,
      ).toBe(204)
      const read = await stream.next('notification.read')
      expect(read.data).toMatchObject({ id })
      const after = await api('GET', '/api/notifications', { token: first.accessToken })
      expect(after.json.items.find((i: { id: string }) => i.id === id).read).toBe(true)
    } finally {
      stream.close()
    }
  })

  test('opening the list zeroes the badge without reading anything, and only newer news counts again', async () => {
    const email = uniqueEmail('seen')
    const first = await login(api, email)
    await untilSignedUpNotifications(first.accessToken)
    const phone = await login(api, email, 'Phone/1.0')
    const unseen = async (token: string) =>
      (await api('GET', '/api/notifications/unseen-count', { token })).json.count as number
    // The welcome notification plus the sign-in from the phone's own login (created asynchronously) are news.
    await eventually(async () => (await unseen(first.accessToken)) >= 2, 10_000, 'unseen')
    const stream = await openSse(t.app, phone.accessToken)
    try {
      await stream.next('ready')
      expect(
        (await api('POST', '/api/notifications/seen', { token: first.accessToken })).status,
      ).toBe(204)
      // The phone is told, so it clears its badge too.
      await stream.next('notification.seen')
      expect(await unseen(first.accessToken)).toBe(0)
      expect(await unseen(phone.accessToken)).toBe(0)
      // Nothing was read.
      expect(await unreadCount(first.accessToken)).toBeGreaterThanOrEqual(SIGN_UP_NOTIFICATIONS)
      const items = (await api('GET', '/api/notifications', { token: first.accessToken })).json
        .items as { read: boolean }[]
      expect(items.every((i) => !i.read)).toBe(true)
    } finally {
      stream.close()
    }
    expect((await api('POST', '/api/notifications/seen')).status).toBe(401)
  })

  test('marking one read is idempotent; unknown or foreign ids are 404', async () => {
    const me = await signUp('read-one')
    const other = await signUp('read-other')
    const id = (await api('GET', '/api/notifications', { token: me.accessToken })).json.items[0]
      .id as string

    for (let i = 0; i < 2; i++)
      expect(
        (await api('POST', `/api/notifications/${id}/read`, { token: me.accessToken })).status,
      ).toBe(204)
    expect(await unreadCount(me.accessToken)).toBe(SIGN_UP_NOTIFICATIONS - 1)

    const foreign = await api('POST', `/api/notifications/${id}/read`, { token: other.accessToken })
    expect(foreign.status).toBe(404)
    expect(foreign.json.error.code).toBe('notification_not_found')
    expect(await unreadCount(other.accessToken)).toBe(SIGN_UP_NOTIFICATIONS)

    const bad = await api('POST', '/api/notifications/not-a-uuid/read', { token: me.accessToken })
    expect(bad.status).toBe(400)
  })

  test('read-all marks everything, filters by unread, and reports the count', async () => {
    const me = await signUp('read-all')
    const unread = await api('GET', '/api/notifications?unread=true', { token: me.accessToken })
    expect(unread.json.items).toHaveLength(SIGN_UP_NOTIFICATIONS)

    const done = await api('POST', '/api/notifications/read-all', { token: me.accessToken })
    expect(done.status).toBe(200)
    expect(done.json).toEqual({ updated: SIGN_UP_NOTIFICATIONS })
    expect(
      (await api('POST', '/api/notifications/read-all', { token: me.accessToken })).json,
    ).toEqual({ updated: 0 })

    expect(
      (await api('GET', '/api/notifications?unread=true', { token: me.accessToken })).json.items,
    ).toHaveLength(0)
    const all = await api('GET', '/api/notifications', { token: me.accessToken })
    expect(all.json.items).toHaveLength(SIGN_UP_NOTIFICATIONS)
    expect(all.json.items.every((i: { read: boolean }) => i.read)).toBe(true)
  })

  test('changing the email adds a notification, delivered live and newest first', async () => {
    const email = uniqueEmail('email-change')
    const me = await login(api, email)
    await untilSignedUpNotifications(me.accessToken)
    const stream = await openSse(t.app, me.accessToken)
    try {
      await stream.next('ready')
      const newEmail = uniqueEmail('email-change-new')
      expect(
        (
          await api('POST', '/api/account/email-change', {
            token: me.accessToken,
            body: { newEmail },
          })
        ).status,
      ).toBe(202)
      const mail = await waitForMail(newEmail, 'Confirm your new email')
      const confirmed = await api('POST', '/api/account/email-change/confirm', {
        body: { token: mail.token },
      })
      expect(confirmed.status).toBe(200)

      const live = await stream.next('notification.created', (m) => m.data.kind === 'email_changed')
      expect(live.data).toMatchObject({
        template: 'emailChanged',
        data: { email: newEmail },
        count: 1,
      })

      const list = await api('GET', '/api/notifications', { token: me.accessToken })
      const kinds = list.json.items.map((i: { kind: string }) => i.kind)
      expect(kinds).toEqual(['email_changed', 'welcome'])
    } finally {
      stream.close()
    }
  })

  test('rejects an out-of-range page size', async () => {
    const me = await signUp('limit')
    expect((await api('GET', '/api/notifications?limit=0', { token: me.accessToken })).status).toBe(
      400,
    )
    expect(
      (await api('GET', '/api/notifications?limit=51', { token: me.accessToken })).status,
    ).toBe(400)
  })
})
