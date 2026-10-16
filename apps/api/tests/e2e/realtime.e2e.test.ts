import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { decodeJwt } from 'jose'
import { client, createTestApp, login, type TestApp, uniqueEmail } from './helpers'

interface Message {
  id: string
  type: string
  data: Record<string, unknown>
  at: string
}

const WAIT_MS = 5_000

/** Minimal SSE client over `app.handle`: buffers parsed events, lets a test await the next matching one. */
async function openSse(app: TestApp['app'], token: string) {
  const controller = new AbortController()
  const res = await app.handle(
    new Request('http://localhost/api/realtime/events', {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    }),
  )
  const received: Message[] = []
  const waiters: (() => void)[] = []
  let ended = false
  void (async () => {
    const reader = res.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf('\n\n')
        while (sep !== -1) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const data = block
            .split('\n')
            .find((l) => l.startsWith('data: '))
            ?.slice(6)
          const event = block
            .split('\n')
            .find((l) => l.startsWith('event: '))
            ?.slice(7)
          if (data && event === 'ready')
            received.push({ id: '', type: 'ready', data: JSON.parse(data), at: '' })
          else if (data) received.push(JSON.parse(data))
          for (const w of waiters.splice(0)) w()
          sep = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // aborted
    }
    ended = true
    for (const w of waiters.splice(0)) w()
  })()

  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    received,
    isClosed: () => ended,
    async next(type: string, match: (m: Message) => boolean = () => true): Promise<Message> {
      const deadline = Date.now() + WAIT_MS
      for (;;) {
        const found = received.find((m) => m.type === type && match(m))
        if (found) return found
        if (ended) throw new Error(`stream ended while waiting for ${type}`)
        const left = deadline - Date.now()
        if (left <= 0) throw new Error(`timed out waiting for ${type}`)
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, left)
        })
      }
    },
    close: () => controller.abort(),
  }
}

let a: TestApp
let b: TestApp // a second API instance on the same database
let apiA: ReturnType<typeof client>
let apiB: ReturnType<typeof client>

beforeAll(async () => {
  a = await createTestApp()
  b = await createTestApp()
  apiA = client(a.app)
  apiB = client(b.app)
})

afterAll(async () => {
  await a.container.close()
  await b.container.close()
})

const sessionIdOf = (accessToken: string) => decodeJwt(accessToken).sid as string

describe('server-sent events', () => {
  test('requires a bearer token', async () => {
    const res = await a.app.handle(new Request('http://localhost/api/realtime/events'))
    expect(res.status).toBe(401)
  })

  test('streams a ready event, then events published for the user — and nobody else’s', async () => {
    const me = await login(apiA, uniqueEmail('sse'))
    const other = await login(apiA, uniqueEmail('sse-other'))
    const mine = await openSse(a.app, me.accessToken)
    const theirs = await openSse(a.app, other.accessToken)
    try {
      expect(mine.status).toBe(200)
      expect(mine.contentType).toContain('text/event-stream')
      const ready = await mine.next('ready')
      expect(ready.data.sessionId).toBe(sessionIdOf(me.accessToken))
      await theirs.next('ready')

      const sent = await apiA('POST', '/api/realtime/test', {
        token: me.accessToken,
        body: { message: 'hello sse' },
      })
      expect(sent.status).toBe(202)
      const event = await mine.next('realtime.test')
      expect(event.data).toMatchObject({ message: 'hello sse' })
      expect(Date.parse(event.at)).not.toBeNaN()

      // Not delivered to another user (the other user gets only their own marker).
      await apiA('POST', '/api/realtime/test', { token: other.accessToken, body: { message: 'x' } })
      await theirs.next('realtime.test')
      expect(mine.received.filter((m) => m.type === 'realtime.test')).toHaveLength(1)
    } finally {
      mine.close()
      theirs.close()
    }
  })

  test('an event published on another API instance reaches the stream (Postgres LISTEN/NOTIFY)', async () => {
    const me = await login(apiA, uniqueEmail('cross'))
    const stream = await openSse(a.app, me.accessToken)
    try {
      await stream.next('ready')
      const sent = await apiB('POST', '/api/realtime/test', {
        token: me.accessToken,
        body: { message: 'from instance B' },
      })
      expect(sent.status).toBe(202)
      expect((await stream.next('realtime.test')).data.message).toBe('from instance B')
    } finally {
      stream.close()
    }
  })

  test('rejects an invalid test message', async () => {
    const me = await login(apiA, uniqueEmail('sse-bad'))
    const res = await apiA('POST', '/api/realtime/test', {
      token: me.accessToken,
      body: { message: '' },
    })
    expect(res.status).toBe(400)
  })
})

describe('session events over realtime', () => {
  test('remote logout reaches the device and closes its connections', async () => {
    const email = uniqueEmail('devices-rt')
    const laptop = await login(apiA, email, 'Laptop/1.0')
    const laptopStream = await openSse(a.app, laptop.accessToken)
    try {
      await laptopStream.next('ready')

      const phone = await login(apiA, email, 'Phone/1.0')
      const phoneId = sessionIdOf(phone.accessToken)

      const phoneStream = await openSse(a.app, phone.accessToken)
      await phoneStream.next('ready')

      const out = await apiB('DELETE', `/api/account/sessions/${phoneId}`, {
        token: laptop.accessToken,
      })
      expect(out.status).toBe(204)

      // The laptop is told about it...
      const onLaptop = await laptopStream.next('session.revoked')
      expect(onLaptop.data).toMatchObject({ sessionId: phoneId, reason: 'revoked_by_user' })
      // ...the phone is told and then disconnected by the server.
      expect((await phoneStream.next('session.revoked')).data.sessionId).toBe(phoneId)
      await eventuallyClosed(phoneStream)
      // The laptop's own connection is untouched.
      expect(laptopStream.isClosed()).toBe(false)
    } finally {
      laptopStream.close()
    }
  })

  test('signing out announces session.revoked with reason "logout"', async () => {
    const me = await login(apiA, uniqueEmail('logout-rt'))
    const stream = await openSse(a.app, me.accessToken)
    await stream.next('ready')
    const out = await apiA('POST', '/api/auth/logout', { token: me.accessToken, cookie: me.cookie })
    expect(out.status).toBe(204)
    expect((await stream.next('session.revoked')).data).toMatchObject({ reason: 'logout' })
    await eventuallyClosed(stream)
  })
})

async function eventuallyClosed(stream: { isClosed(): boolean }) {
  const deadline = Date.now() + WAIT_MS
  while (!stream.isClosed()) {
    if (Date.now() > deadline) throw new Error('stream was not closed by the server')
    await new Promise((r) => setTimeout(r, 25))
  }
}
