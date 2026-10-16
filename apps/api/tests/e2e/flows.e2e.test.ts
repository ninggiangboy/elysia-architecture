import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'
import { IdentityEvents } from '#/modules/identity/contracts'
import { sha256Hex } from '#/shared/infrastructure/crypto'
import {
  client,
  createTestApp,
  eventually,
  login,
  mailsTo,
  PNG_1X1,
  sleep,
  type TestApp,
  uniqueEmail,
  uniqueIp,
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

describe('health & plumbing', () => {
  test('liveness and readiness', async () => {
    expect((await api('GET', '/api/health/live')).status).toBe(200)
    const ready = await api('GET', '/api/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.json.database).toBe('up')
  })

  test('unknown route and validation errors use the error envelope', async () => {
    const missing = await api('GET', '/api/nope')
    expect(missing.status).toBe(404)
    expect(missing.json.error.code).toBe('route_not_found')
    const bad = await api('POST', '/api/auth/magic-link', { body: { nope: 1 } })
    expect(bad.status).toBe(400)
    expect(bad.json.error.code).toBe('validation_error')
    const badEmail = await api('POST', '/api/auth/magic-link', { body: { email: 'not-an-email' } })
    expect(badEmail.status).toBe(400)
    expect(badEmail.json.error.code).toBe('invalid_email')
  })

  test('x-request-id is echoed and correlation id travels into the outbox headers', async () => {
    const email = uniqueEmail('corr')
    const res = await api('POST', '/api/auth/magic-link', {
      body: { email },
      headers: { 'x-request-id': 'req-abc-1', 'x-correlation-id': 'corr-xyz-9' },
    })
    expect(res.status).toBe(202)
    expect(res.headers.get('x-request-id')).toBe('req-abc-1')
    const rows = await t.container.database.db.execute<{
      headers: Record<string, string>
    }>(sql`select headers from identity.outbox_messages where payload->>'email' = ${email}`)
    expect(rows[0]?.headers.correlationId).toBe('corr-xyz-9')
    expect(rows[0]?.headers.causationId).toBe('req-abc-1')
  })
})

describe('full user journey', () => {
  const email = uniqueEmail('journey')
  const ip = uniqueIp()
  let accessToken = ''
  let userId = ''
  let cookie = ''

  test('request magic link → mail → verify creates the user and a session', async () => {
    const requested = await api('POST', '/api/auth/magic-link', {
      body: { email: ` ${email.toUpperCase()} ` },
      ip,
    })
    expect(requested.status).toBe(202)

    const mail = await waitForMail(email, 'sign-in')
    expect(mail.token).toBeTruthy()

    const wrong = await api('POST', '/api/auth/magic-link/verify', { body: { token: 'nope' }, ip })
    expect(wrong.status).toBe(400)
    expect(wrong.json.error.code).toBe('invalid_magic_link')

    const verified = await api('POST', '/api/auth/magic-link/verify', {
      body: { token: mail.token },
      ip,
    })
    expect(verified.status).toBe(200)
    expect(verified.json.user.email).toBe(email)
    expect(verified.json.expiresIn).toBe(900)
    expect(verified.setCookie).toContain('HttpOnly')
    expect(verified.setCookie).toContain('Path=/api/auth')
    accessToken = verified.json.accessToken
    userId = verified.json.user.id
    cookie = verified.refreshCookie!

    // The link is single-use
    const replay = await api('POST', '/api/auth/magic-link/verify', {
      body: { token: mail.token },
      ip,
    })
    expect(replay.status).toBe(400)
  })

  test('access token is verifiable through the published JWKS (no shared secret)', async () => {
    const jwks = await api('GET', '/api/.well-known/jwks.json')
    expect(jwks.status).toBe(200)
    const { payload, protectedHeader } = await jwtVerify(
      accessToken,
      createLocalJWKSet(jwks.json),
      {
        issuer: t.config.JWT_ISSUER,
        audience: t.config.JWT_AUDIENCE,
      },
    )
    expect(protectedHeader.alg).toBe('ES256')
    expect(payload.sub).toBe(userId)
  })

  test('GET /me requires auth and works before the profile exists (eventual consistency)', async () => {
    expect((await api('GET', '/api/me')).status).toBe(401)
    expect((await api('GET', '/api/me', { token: 'garbage' })).status).toBe(401)
    const me = await api('GET', '/api/me', { token: accessToken })
    expect(me.status).toBe(200)
    expect(me.json.email).toBe(email)
    expect(me.json.displayName).toBe(email.split('@')[0])
  })

  test('user_registered fans out to welcome mail and profile creation (two independent consumers)', async () => {
    const welcome = await waitForMail(email, 'Welcome')
    expect(welcome.text).toContain(email)
    await eventually(
      async () => (await api('GET', '/api/me', { token: accessToken })).json.version === 1,
      10_000,
      'profile row',
    )
  })

  test('update profile with optimistic locking', async () => {
    const ok = await api('PATCH', '/api/me/profile', {
      token: accessToken,
      headers: { 'if-match': '1' },
      body: { displayName: '  Jane Doe ', bio: 'Hello there' },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.displayName).toBe('Jane Doe')
    expect(ok.json.bio).toBe('Hello there')
    expect(ok.json.version).toBe(2)

    const stale = await api('PATCH', '/api/me/profile', {
      token: accessToken,
      headers: { 'if-match': '1' },
      body: { displayName: 'Stale' },
    })
    expect(stale.status).toBe(409)
    expect(stale.json.error.code).toBe('version_conflict')

    const invalid = await api('PATCH', '/api/me/profile', {
      token: accessToken,
      body: { displayName: '   ' },
    })
    expect(invalid.status).toBe(400)
    expect(invalid.json.error.code).toBe('invalid_display_name')

    const cleared = await api('PATCH', '/api/me/profile', {
      token: accessToken,
      body: { bio: null },
    })
    expect(cleared.json.bio).toBeNull()
    expect(cleared.json.displayName).toBe('Jane Doe')
  })

  test('concurrent updates with the same version: exactly one wins', async () => {
    const me = await api('GET', '/api/me', { token: accessToken })
    const attempt = (name: string) =>
      api('PATCH', '/api/me/profile', {
        token: accessToken,
        headers: { 'if-match': String(me.json.version) },
        body: { displayName: name },
      })
    const results = await Promise.all([attempt('Racer A'), attempt('Racer B')])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })

  test('avatar upload through presigned URL, validation and old-avatar cleanup', async () => {
    const rejectedType = await api('POST', '/api/me/avatar/upload-url', {
      token: accessToken,
      body: { contentType: 'image/gif', contentLength: 10 },
    })
    expect(rejectedType.json.error.code).toBe('unsupported_avatar_type')
    const tooBig = await api('POST', '/api/me/avatar/upload-url', {
      token: accessToken,
      body: { contentType: 'image/png', contentLength: 5 * 1024 * 1024 },
    })
    expect(tooBig.json.error.code).toBe('avatar_too_large')

    const upload = async () => {
      const ticket = await api('POST', '/api/me/avatar/upload-url', {
        token: accessToken,
        body: { contentType: 'image/png', contentLength: PNG_1X1.length },
      })
      expect(ticket.status).toBe(200)
      expect(ticket.json.key.startsWith(`${userId}/`)).toBe(true)
      const put = await fetch(ticket.json.uploadUrl, {
        method: 'PUT',
        headers: ticket.json.headers,
        body: PNG_1X1,
      })
      expect(put.status).toBe(200)
      return ticket.json.key as string
    }

    // Set before uploading → error; someone else's key → error
    const missing = await api('PUT', '/api/me/avatar', {
      token: accessToken,
      body: { key: `${userId}/missing.png` },
    })
    expect(missing.json.error.code).toBe('avatar_not_uploaded')
    const foreign = await api('PUT', '/api/me/avatar', {
      token: accessToken,
      body: { key: 'someone-else/x.png' },
    })
    expect(foreign.json.error.code).toBe('invalid_avatar_key')

    const firstKey = await upload()
    const set = await api('PUT', '/api/me/avatar', { token: accessToken, body: { key: firstKey } })
    expect(set.status).toBe(200)
    const image = await fetch(set.json.avatarUrl)
    expect(image.status).toBe(200)
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG_1X1)

    const secondKey = await upload()
    expect(
      (await api('PUT', '/api/me/avatar', { token: accessToken, body: { key: secondKey } })).status,
    ).toBe(200)
    // the profile.delete-old-avatar handler deletes the old file via the outbox
    await eventually(
      async () => !(await t.container.storage.stat(firstKey)),
      10_000,
      'old avatar removal',
    )
    expect(await t.container.storage.stat(secondKey)).not.toBeNull()
  })

  test('refresh rotates the token; reuse of a rotated token revokes the whole session', async () => {
    const first = await api('POST', '/api/auth/refresh', { cookie })
    expect(first.status).toBe(200)
    expect(first.json.accessToken).toBeTruthy()
    const rotated = first.refreshCookie!
    expect(rotated).not.toBe(cookie)

    // Reuse right away (within the 10s grace, e.g. two tabs) → rejected but the session is NOT revoked
    const concurrent = await api('POST', '/api/auth/refresh', { cookie })
    expect(concurrent.status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: rotated })).status).toBe(200)

    // Simulate the old token being reused after the grace window → treated as stolen
    const latest = (await api('POST', '/api/auth/refresh', { cookie: rotated })).refreshCookie!
    await t.container.database.db.execute(
      sql`update identity.refresh_tokens set revoked_at = now() - interval '1 minute' where token_hash = ${sha256Hex(rotated.split('=')[1]!)}`,
    )
    expect((await api('POST', '/api/auth/refresh', { cookie: rotated })).status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: latest })).status).toBe(401)
  })

  test('no cookie / garbage cookie on refresh is 401', async () => {
    expect((await api('POST', '/api/auth/refresh')).status).toBe(401)
    expect(
      (await api('POST', '/api/auth/refresh', { cookie: 'refresh_token=garbage' })).status,
    ).toBe(401)
  })

  test('change email requires confirmation from the new address', async () => {
    const session = await login(api, email)
    const other = uniqueEmail('taken')
    await login(api, other)

    const taken = await api('POST', '/api/account/email-change', {
      token: session.accessToken,
      body: { newEmail: other },
    })
    expect(taken.status).toBe(409)
    expect(taken.json.error.code).toBe('email_taken')
    const same = await api('POST', '/api/account/email-change', {
      token: session.accessToken,
      body: { newEmail: email },
    })
    expect(same.json.error.code).toBe('email_unchanged')
    expect(
      (await api('POST', '/api/account/email-change', { body: { newEmail: uniqueEmail() } }))
        .status,
    ).toBe(401)

    const newEmail = uniqueEmail('new')
    const requested = await api('POST', '/api/account/email-change', {
      token: session.accessToken,
      body: { newEmail },
    })
    expect(requested.status).toBe(202)
    const mail = await waitForMail(newEmail, 'Confirm')

    expect(
      (await api('POST', '/api/account/email-change/confirm', { body: { token: 'bad' } })).status,
    ).toBe(400)
    const confirmed = await api('POST', '/api/account/email-change/confirm', {
      body: { token: mail.token },
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.json.email).toBe(newEmail)
    expect(
      (await api('POST', '/api/account/email-change/confirm', { body: { token: mail.token } }))
        .status,
    ).toBe(400)

    const me = await api('GET', '/api/me', { token: session.accessToken })
    expect(me.json.email).toBe(newEmail)
    await waitForMail(email, 'was changed') // notification sent to the old email
  })

  test('logout revokes the session', async () => {
    const session = await login(api, uniqueEmail('logout'))
    expect((await api('POST', '/api/auth/logout')).status).toBe(401)
    const out = await api('POST', '/api/auth/logout', {
      token: session.accessToken,
      cookie: session.cookie,
    })
    expect(out.status).toBe(204)
    expect(out.setCookie).toContain('refresh_token=;')
    expect((await api('POST', '/api/auth/refresh', { cookie: session.cookie })).status).toBe(401)
  })
})

describe('device sessions', () => {
  const sessionIdOf = (accessToken: string) => decodeJwt(accessToken).sid as string

  test('lists devices, remotely signs one out, and keeps the others working', async () => {
    const email = uniqueEmail('devices')
    const phone = await login(api, email, 'PhoneApp/1.0')
    const laptop = await login(api, email, 'LaptopBrowser/2.0')

    expect((await api('GET', '/api/account/sessions')).status).toBe(401)
    const listed = await api('GET', '/api/account/sessions', { token: laptop.accessToken })
    expect(listed.status).toBe(200)
    expect(listed.json.sessions).toHaveLength(2)
    expect(listed.json.sessions[0]).toMatchObject({
      id: sessionIdOf(laptop.accessToken),
      current: true,
      userAgent: 'LaptopBrowser/2.0',
    })
    expect(listed.json.sessions[1]).toMatchObject({
      id: sessionIdOf(phone.accessToken),
      current: false,
      userAgent: 'PhoneApp/1.0',
    })
    expect(Date.parse(listed.json.sessions[0].startedAt)).not.toBeNaN()

    const out = await api('DELETE', `/api/account/sessions/${sessionIdOf(phone.accessToken)}`, {
      token: laptop.accessToken,
      cookie: laptop.cookie,
    })
    expect(out.status).toBe(204)
    expect(out.setCookie).toBeNull() // not the current device → its own cookie is untouched

    expect((await api('POST', '/api/auth/refresh', { cookie: phone.cookie })).status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: laptop.cookie })).status).toBe(200)
    const after = await api('GET', '/api/account/sessions', { token: laptop.accessToken })
    expect(after.json.sessions.map((s: { id: string }) => s.id)).toEqual([
      sessionIdOf(laptop.accessToken),
    ])
  })

  test('cannot touch another user’s session; unknown or malformed ids are rejected', async () => {
    const mine = await login(api, uniqueEmail('mine'))
    const theirs = await login(api, uniqueEmail('theirs'))

    const stolen = await api('DELETE', `/api/account/sessions/${sessionIdOf(theirs.accessToken)}`, {
      token: mine.accessToken,
    })
    expect(stolen.status).toBe(404)
    expect(stolen.json.error.code).toBe('session_not_found')
    expect((await api('POST', '/api/auth/refresh', { cookie: theirs.cookie })).status).toBe(200)

    expect(
      (await api('DELETE', '/api/account/sessions/not-a-uuid', { token: mine.accessToken })).status,
    ).toBe(400)
  })

  test('revoking the current session also clears the cookie; "all others" keeps the caller', async () => {
    const email = uniqueEmail('others')
    const a = await login(api, email)
    const b = await login(api, email)
    const c = await login(api, email)

    const out = await api('DELETE', '/api/account/sessions', { token: a.accessToken })
    expect(out.status).toBe(200)
    expect(out.json).toEqual({ revoked: 2 })
    expect((await api('POST', '/api/auth/refresh', { cookie: b.cookie })).status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: c.cookie })).status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: a.cookie })).status).toBe(200)

    const self = await api('DELETE', `/api/account/sessions/${sessionIdOf(a.accessToken)}`, {
      token: a.accessToken,
    })
    expect(self.status).toBe(204)
    expect(self.setCookie).toContain('refresh_token=;')
  })
})

describe('abuse protection', () => {
  test('magic link requests are rate limited per email (database-backed, multi-instance safe)', async () => {
    const email = uniqueEmail('spam')
    const limit = t.config.MAGIC_LINK_MAX_PER_EMAIL
    for (let i = 0; i < limit; i++) {
      expect((await api('POST', '/api/auth/magic-link', { body: { email } })).status).toBe(202)
    }
    const blocked = await api('POST', '/api/auth/magic-link', { body: { email } })
    expect(blocked.status).toBe(429)
    expect(blocked.json.error.code).toBe('magic_link_rate_limited')
  })

  test('magic link requests are rate limited per IP', async () => {
    const ip = uniqueIp()
    const limit = t.config.MAGIC_LINK_MAX_PER_IP
    for (let i = 0; i < limit; i++) {
      expect(
        (await api('POST', '/api/auth/magic-link', { body: { email: uniqueEmail('ip') }, ip }))
          .status,
      ).toBe(202)
    }
    expect(
      (await api('POST', '/api/auth/magic-link', { body: { email: uniqueEmail('ip') }, ip }))
        .status,
    ).toBe(429)
  })
})

describe('messaging guarantees', () => {
  test('redelivering the same envelope does not repeat side effects (inbox idempotency)', async () => {
    const email = uniqueEmail('dup')
    const envelope = {
      id: Bun.randomUUIDv7(),
      type: IdentityEvents.UserRegistered,
      source: 'identity',
      aggregateId: Bun.randomUUIDv7(),
      occurredAt: new Date().toISOString(),
      payload: { userId: Bun.randomUUIDv7(), email, registeredAt: new Date().toISOString() },
      headers: {},
    }
    await t.container.bus.publish(envelope)
    await t.container.bus.publish(envelope)
    await sleep(500)
    const welcomes = (await mailsTo(email)).filter((m) => m.Subject.includes('Welcome'))
    expect(welcomes).toHaveLength(1)
  })

  test('a failing handler is retried with backoff and the successful one is not repeated', async () => {
    const email = uniqueEmail('retry')
    const { table } = t.container.modules.identity.outbox
    const mod = t.container.database
    let failures = 0
    const original = t.container.bus.publish.bind(t.container.bus)
    t.container.bus.publish = async (m) => {
      if (
        m.type === IdentityEvents.UserRegistered &&
        (m.payload as { email?: string }).email === email &&
        failures++ < 1
      ) {
        throw new Error('simulated broker outage')
      }
      return original(m)
    }
    try {
      const id = Bun.randomUUIDv7()
      await mod.db.insert(table).values({
        id,
        type: IdentityEvents.UserRegistered,
        aggregateId: id,
        payload: { userId: id, email, registeredAt: new Date().toISOString() },
        headers: {},
        occurredAt: new Date(),
      })
      await waitForMail(email, 'Welcome')
      expect(failures).toBe(2) // 1st attempt failed, 2nd (after backoff) succeeded
      // The relay marks the row published after the handlers finish, which can land just after the mail arrives.
      const row = await eventually(
        async () => {
          const rows = await mod.db.execute<{ attempts: number; published_at: Date | null }>(
            sql`select attempts, published_at from identity.outbox_messages where id = ${id}`,
          )
          return rows[0]?.published_at ? rows[0] : null
        },
        5_000,
        'outbox row marked published',
      )
      expect(row.attempts).toBe(2)
    } finally {
      t.container.bus.publish = original
    }
  }, 20_000)
})
