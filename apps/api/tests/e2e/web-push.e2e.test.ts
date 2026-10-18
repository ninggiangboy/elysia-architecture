import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { PushMessage, PushOutcome, PushTarget, WebPushSender } from '@mod/notification/testing'
import webpush from 'web-push'
import { client, createTestApp, eventually, login, type TestApp, uniqueEmail } from './helpers'

class RecordingSender implements WebPushSender {
  sent: { target: PushTarget; message: PushMessage }[] = []
  outcome: PushOutcome = 'delivered'
  async send(target: PushTarget, message: PushMessage) {
    this.sent.push({ target, message })
    return this.outcome
  }
  to(endpoint: string) {
    return this.sent.filter((s) => s.target.endpoint === endpoint)
  }
}

const vapid = webpush.generateVAPIDKeys()
const sender = new RecordingSender()
let t: TestApp
let api: ReturnType<typeof client>

beforeAll(async () => {
  t = await createTestApp(
    { webPushSender: sender },
    {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.test',
    },
  )
  api = client(t.app)
})

afterAll(async () => {
  await t.container.close()
})

const KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1',
  auth: 'tBHItJI5svbpez7KI4CCXg',
}
const uniqueEndpoint = () => `https://push.example.com/send/${crypto.randomUUID()}`
const unreadCount = async (token: string) =>
  (await api('GET', '/api/notifications/unread-count', { token })).json.count as number

/** Signs a new user in and waits for their welcome notification, so it cannot be pushed to a later subscription. */
async function signUp(tag: string) {
  const email = uniqueEmail(tag)
  const me = { ...(await login(api, email)), email }
  await eventually(async () => (await unreadCount(me.accessToken)) >= 1, 10_000, 'welcome')
  return me
}

const subscribe = (token: string, endpoint: string) =>
  api('PUT', '/api/notifications/push/subscription', { token, body: { endpoint, keys: KEYS } })

describe('web push', () => {
  test('publishes the VAPID public key without authentication', async () => {
    const res = await api('GET', '/api/notifications/push/public-key')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ publicKey: vapid.publicKey })
  })

  test('subscribing requires a token and a safe endpoint', async () => {
    const endpoint = uniqueEndpoint()
    expect(
      (await api('PUT', '/api/notifications/push/subscription', { body: { endpoint, keys: KEYS } }))
        .status,
    ).toBe(401)
    const me = await login(api, uniqueEmail('push-validate'))
    for (const bad of ['http://push.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x']) {
      const res = await subscribe(me.accessToken, bad)
      expect(res.status).toBe(400)
      expect(res.json.error.code).toBe('invalid_push_subscription')
    }
  })

  test('a notification is pushed to every subscribed browser of the user', async () => {
    const first = await signUp('push-fanout')
    const email = first.email
    const one = uniqueEndpoint()
    const two = uniqueEndpoint()
    expect((await subscribe(first.accessToken, one)).status).toBe(204)
    expect((await subscribe(first.accessToken, one)).status).toBe(204) // idempotent
    expect((await subscribe(first.accessToken, two)).status).toBe(204)

    // A second sign-in of the same account raises a "new sign-in" notification.
    await login(api, email)
    await eventually(
      async () => sender.to(one).length > 0 && sender.to(two).length > 0,
      10_000,
      'push to both browsers',
    )
    const pushed = sender.to(one)[0]?.message
    expect(pushed).toMatchObject({
      title: 'New sign-in to your account',
      link: '/settings/security',
    })
    expect(pushed?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(sender.to(one)[0]?.target).toMatchObject(KEYS)
    expect(sender.to(one)).toHaveLength(1)
  })

  test('nothing is pushed after unsubscribing, nor to other accounts', async () => {
    const me = await signUp('push-off')
    const email = me.email
    const bystander = await signUp('push-bystander')
    const mine = uniqueEndpoint()
    const theirs = uniqueEndpoint()
    await subscribe(me.accessToken, mine)
    await subscribe(bystander.accessToken, theirs)

    // Another user cannot remove my subscription; I can, and repeating it is fine.
    const foreign = await api('DELETE', '/api/notifications/push/subscription', {
      token: bystander.accessToken,
      body: { endpoint: mine },
    })
    expect(foreign.status).toBe(204)
    for (let i = 0; i < 2; i++) {
      const res = await api('DELETE', '/api/notifications/push/subscription', {
        token: me.accessToken,
        body: { endpoint: mine },
      })
      expect(res.status).toBe(204)
    }

    const before = sender.sent.length
    await login(api, email) // raises a notification for `me`
    await eventually(
      async () =>
        (await api('GET', '/api/notifications/unread-count', { token: me.accessToken })).json
          .count >= 2,
      10_000,
      'second notification',
    )
    await Bun.sleep(500)
    expect(sender.to(mine)).toHaveLength(0)
    expect(sender.to(theirs)).toHaveLength(0)
    expect(sender.sent.length).toBe(before)
  })

  test('signing a device out ends its push subscription', async () => {
    const email = uniqueEmail('push-logout')
    const first = await login(api, email)
    await eventually(async () => (await unreadCount(first.accessToken)) >= 1, 10_000, 'welcome')
    const second = await login(api, email)
    const phone = uniqueEndpoint()
    const laptop = uniqueEndpoint()
    await subscribe(first.accessToken, phone)
    await subscribe(second.accessToken, laptop)

    // Sign the first device out remotely (the same flow as the "sign out that device" button).
    const sessions = await api('GET', '/api/account/sessions', { token: second.accessToken })
    const firstSession = sessions.json.sessions.find((s: { current: boolean }) => !s.current) as {
      id: string
    }
    expect(
      (
        await api('DELETE', `/api/account/sessions/${firstSession.id}`, {
          token: second.accessToken,
        })
      ).status,
    ).toBe(204)
    await Bun.sleep(1500) // the relay delivers session.revoked

    sender.sent.length = 0
    await login(api, email) // a notification for the account
    await eventually(async () => sender.to(laptop).length >= 1, 10_000, 'push to the laptop')
    expect(sender.to(phone)).toHaveLength(0)
  })

  test('a subscription the push service reports gone is removed', async () => {
    const me = await signUp('push-gone')
    const email = me.email
    const endpoint = uniqueEndpoint()
    await subscribe(me.accessToken, endpoint)
    sender.outcome = 'gone'
    try {
      await login(api, email)
      await eventually(async () => sender.to(endpoint).length >= 1, 10_000, 'first attempt')
      await login(api, email)
      await eventually(
        async () =>
          (await api('GET', '/api/notifications/unread-count', { token: me.accessToken })).json
            .count >= 3,
        10_000,
        'third notification',
      )
      await Bun.sleep(500)
      expect(sender.to(endpoint)).toHaveLength(1) // deleted after the first 410, never tried again
    } finally {
      sender.outcome = 'delivered'
    }
  })
})
