import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createLocalJWKSet, jwtVerify } from 'jose'
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
    expect(ready.json.databases).toEqual({ identity: 'up', profile: 'up', notification: 'up' })
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
    const rows = await t.container.modules.identity.mod.db.execute<{
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

    const mail = await waitForMail(email, 'đăng nhập')
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

    // Link dùng một lần
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
    const welcome = await waitForMail(email, 'Chào mừng')
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
      body: { displayName: '  Nguyễn Văn A ', bio: 'Xin chào' },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.displayName).toBe('Nguyễn Văn A')
    expect(ok.json.bio).toBe('Xin chào')
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
    expect(cleared.json.displayName).toBe('Nguyễn Văn A')
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

    // Chưa upload mà đã set → lỗi; key của người khác → lỗi
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
    // handler profile.delete-old-avatar xoá file cũ qua outbox
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

    // Dùng lại ngay (trong grace 10s, vd. hai tab) → từ chối nhưng KHÔNG thu hồi phiên
    const concurrent = await api('POST', '/api/auth/refresh', { cookie })
    expect(concurrent.status).toBe(401)
    expect((await api('POST', '/api/auth/refresh', { cookie: rotated })).status).toBe(200)

    // Giả lập token cũ bị dùng lại sau grace → coi là bị đánh cắp
    const latest = (await api('POST', '/api/auth/refresh', { cookie: rotated })).refreshCookie!
    await t.container.modules.identity.mod.db.execute(
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
    const mail = await waitForMail(newEmail, 'Xác nhận')

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
    await waitForMail(email, 'đã được thay đổi') // thông báo gửi tới email cũ
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
    const welcomes = (await mailsTo(email)).filter((m) => m.Subject.includes('Chào mừng'))
    expect(welcomes).toHaveLength(1)
  })

  test('a failing handler is retried with backoff and the successful one is not repeated', async () => {
    const email = uniqueEmail('retry')
    const { mod, table } = t.container.modules.identity.outbox
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
      await waitForMail(email, 'Chào mừng')
      expect(failures).toBe(2) // lần 1 lỗi, lần 2 (sau backoff) thành công
      const row = await mod.db.execute<{ attempts: number; published_at: Date | null }>(
        sql`select attempts, published_at from identity.outbox_messages where id = ${id}`,
      )
      expect(row[0]?.attempts).toBe(2)
      expect(row[0]?.published_at).not.toBeNull()
    } finally {
      t.container.bus.publish = original
    }
  }, 20_000)
})
