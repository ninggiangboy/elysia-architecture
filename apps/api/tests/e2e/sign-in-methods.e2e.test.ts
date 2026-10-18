import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { totpCode } from '@kit/auth'
import { decodeJwt } from 'jose'
import {
  client,
  createTestApp,
  eventually,
  login,
  mailsTo,
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

const PASSWORD = 'correct horse battery'

/** Setup steps fail loudly with the response, instead of asserting outside a test. */
function ensure(res: { status: number; json?: unknown }, status: number, step: string) {
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status} ${JSON.stringify(res.json)}`)
  }
}

const codeIn = (text: string) => text.match(/\b(\d{6})\b/)?.[1] as string

/** Sign up with a password and finish with the code from the mail. */
async function signUp(call = api, email = uniqueEmail('pw'), extra: Record<string, unknown> = {}) {
  const ip = uniqueIp()
  const sent = await call('POST', '/api/auth/register', {
    body: { email, password: PASSWORD, ...extra },
    ip,
  })
  ensure(sent, 202, 'register')
  const mail = await waitForMail(email, 'Confirm your email')
  const verified = await call('POST', '/api/auth/register/verify', {
    body: { email, code: codeIn(mail.subject) },
    ip,
  })
  ensure(verified, 200, 'verify sign-up')
  return {
    email,
    userId: verified.json.user.id as string,
    accessToken: verified.json.accessToken as string,
    cookie: verified.refreshCookie as string,
  }
}

describe('what the deployment offers', () => {
  test('GET /auth/options lists methods, registration, providers and two-factor', async () => {
    const res = await api('GET', '/api/auth/options')
    expect(res.status).toBe(200)
    expect(res.json.methods).toEqual(['email', 'password', 'passkey'])
    expect(res.json).toMatchObject({
      registration: 'open',
      passwordMinLength: 8,
      twoFactor: true,
      termsVersion: null,
    })
    expect(Array.isArray(res.json.providers)).toBe(true)
  })
})

describe('sign up and sign in with a password', () => {
  test('sign-up needs the mailbox: no account until the code is typed', async () => {
    const email = uniqueEmail('pw')
    const sent = await api('POST', '/api/auth/register', { body: { email, password: PASSWORD } })
    expect(sent.status).toBe(202)
    // Nobody can sign in with it yet.
    const early = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
    expect(early.status).toBe(401)

    const mail = await waitForMail(email, 'Confirm your email')
    const wrong = await api('POST', '/api/auth/register/verify', {
      body: { email, code: '000000' },
    })
    expect(wrong.status).toBe(400)
    const ok = await api('POST', '/api/auth/register/verify', {
      body: { email, code: codeIn(mail.subject) },
    })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ status: 'authenticated', user: { email } })
    expect(ok.refreshCookie).toBeTruthy()
    // a fresh sign-in counts as a recent confirmation
    expect(decodeJwt(ok.json.accessToken).auth_time).toBeGreaterThan(Date.now() / 1000 - 30)

    const signedIn = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
    expect(signedIn.status).toBe(200)
    expect(signedIn.json.user.id).toBe(ok.json.user.id)
  })

  test('the link in the mail verifies too, once', async () => {
    const email = uniqueEmail('pw')
    ensure(
      await api('POST', '/api/auth/register', { body: { email, password: PASSWORD } }),
      202,
      'register',
    )
    const mail = await waitForMail(email, 'Confirm your email')
    expect(mail.token).toBeTruthy()
    const first = await api('POST', '/api/auth/register/verify', { body: { token: mail.token } })
    expect(first.status).toBe(200)
    const again = await api('POST', '/api/auth/register/verify', { body: { token: mail.token } })
    expect(again.status).toBe(400)
  })

  test('a wrong password, an unknown address and a bad one all answer the same', async () => {
    const { email } = await signUp()
    const wrong = await api('POST', '/api/auth/login', { body: { email, password: 'not the one' } })
    const unknown = await api('POST', '/api/auth/login', {
      body: { email: uniqueEmail('ghost'), password: PASSWORD },
    })
    const malformed = await api('POST', '/api/auth/login', {
      body: { email: 'not-an-email', password: PASSWORD },
    })
    for (const res of [wrong, unknown, malformed]) {
      expect(res.status).toBe(401)
      expect(res.json.error.code).toBe('invalid_credentials')
    }
  })

  test('a short password is refused up front', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail('pw'), password: 'short' },
    })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('password_too_short')
  })

  test('signing up with an address that has an account looks the same, and tells its owner', async () => {
    const { email } = await signUp()
    const again = await api('POST', '/api/auth/register', {
      body: { email, password: 'another long one' },
    })
    expect(again.status).toBe(202)
    expect(again.json).toEqual({ status: 'sent' })
    await waitForMail(email, 'You already have an account')
    // the original password still works, the new one does not
    expect(
      (await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })).status,
    ).toBe(200)
    expect(
      (await api('POST', '/api/auth/login', { body: { email, password: 'another long one' } }))
        .status,
    ).toBe(401)
  })

  test('failed attempts are limited per address', async () => {
    const { email } = await signUp()
    let last = 0
    for (let i = 0; i < 12 && last !== 429; i++) {
      last = (await api('POST', '/api/auth/login', { body: { email, password: `wrong ${i} !!!` } }))
        .status
    }
    expect(last).toBe(429)
    const locked = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
    expect(locked.status).toBe(429)
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('sign in with the code from the magic-link mail', () => {
  test('the 6 digits sign in on their own, and only once', async () => {
    const email = uniqueEmail('code')
    ensure(await api('POST', '/api/auth/magic-link', { body: { email } }), 202, 'request')
    const mail = await waitForMail(email, 'sign-in')
    const code = codeIn(mail.text.replace(mail.token ?? '', ''))
    expect(code).toBeTruthy()

    const wrong = await api('POST', '/api/auth/email-code/verify', {
      body: { email, code: code === '000000' ? '111111' : '000000' },
    })
    expect(wrong.status).toBe(400)
    expect(wrong.json.error.code).toBe('invalid_email_code')

    const ok = await api('POST', '/api/auth/email-code/verify', { body: { email, code } })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ status: 'authenticated', user: { email } })

    const reuse = await api('POST', '/api/auth/email-code/verify', { body: { email, code } })
    expect(reuse.status).toBe(400)
    // the link in the same mail is the same sign-in: it is used up too
    const link = await api('POST', '/api/auth/magic-link/verify', { body: { token: mail.token } })
    expect(link.status).toBe(400)
  })
})

describe('forgotten password', () => {
  test('the mailed link sets a new password and signs the account out everywhere', async () => {
    const user = await signUp()
    const asked = await api('POST', '/api/auth/password/forgot', { body: { email: user.email } })
    expect(asked.status).toBe(202)
    const mail = await waitForMail(user.email, 'Reset your password')

    const reset = await api('POST', '/api/auth/password/reset', {
      body: { token: mail.token, newPassword: 'a brand new password' },
    })
    expect(reset.status).toBe(204)

    const refresh = await api('POST', '/api/auth/refresh', { cookie: user.cookie })
    expect(refresh.status).toBe(401)
    expect(
      (await api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }))
        .status,
    ).toBe(401)
    expect(
      (
        await api('POST', '/api/auth/login', {
          body: { email: user.email, password: 'a brand new password' },
        })
      ).status,
    ).toBe(200)
    await waitForMail(user.email, 'Your password changed')

    const reuse = await api('POST', '/api/auth/password/reset', {
      body: { token: mail.token, newPassword: 'yet another password' },
    })
    expect(reuse.status).toBe(400)
  })

  test('an unknown address gets the same answer and no mail', async () => {
    const email = uniqueEmail('ghost')
    const res = await api('POST', '/api/auth/password/forgot', { body: { email } })
    expect(res.status).toBe(202)
    await sleep(1200)
    expect(await mailsTo(email)).toHaveLength(0)
  })
})

describe('managing the password', () => {
  test('an account made by magic link can set one (step-up), then sign in with it', async () => {
    const session = await login(api, uniqueEmail('later'))
    const set = await api('PUT', '/api/account/password', {
      token: session.accessToken,
      body: { newPassword: PASSWORD },
    })
    expect(set.status).toBe(200)
    expect(set.json.change).toBe('set')

    const security = await api('GET', '/api/account/security', { token: session.accessToken })
    expect(security.json).toMatchObject({ hasPassword: true, emailSignIn: true })

    const refreshed = await api('POST', '/api/auth/refresh', { cookie: session.cookie })
    ensure(refreshed, 200, 'refresh')
    const stale = refreshed.json.accessToken as string
    const blocked = await api('PUT', '/api/account/password', {
      token: stale,
      body: { newPassword: 'changed to this one' },
    })
    expect(blocked.status).toBe(403)

    const confirmed = await api('POST', '/api/account/step-up/password', {
      token: stale,
      body: { password: PASSWORD },
    })
    expect(confirmed.status).toBe(200)
    const wrong = await api('POST', '/api/account/step-up/password', {
      token: stale,
      body: { password: 'definitely not it' },
    })
    expect(wrong.status).toBe(400)
    expect(wrong.json.error.code).toBe('invalid_step_up_password')

    const removed = await api('DELETE', '/api/account/password', {
      token: confirmed.json.accessToken,
    })
    expect(removed.status).toBe(204)
    const after = await api('GET', '/api/account/security', { token: confirmed.json.accessToken })
    expect(after.json.hasPassword).toBe(false)
  })
})

describe('two-factor with an authenticator app', () => {
  /** An account with the authenticator on. `secret` is what the user's app holds. */
  async function enrol() {
    const user = await signUp()
    const setup = await api('POST', '/api/account/two-factor/setup', { token: user.accessToken })
    ensure(setup, 200, 'setup')
    if (!String(setup.json.uri).startsWith('otpauth://totp/')) throw new Error('no otpauth URI')
    const secret = setup.json.secret as string
    const enabled = await api('POST', '/api/account/two-factor/enable', {
      token: user.accessToken,
      body: { code: totpCode(secret, new Date()) },
    })
    ensure(enabled, 200, 'enable')
    return { ...user, secret, recoveryCodes: enabled.json.recoveryCodes as string[] }
  }
  /** A code for the next 30-second step: accepted as clock drift, and newer than the one used to enrol. */
  const nextCode = (secret: string, steps = 1) =>
    totpCode(secret, new Date(Date.now() + steps * 30_000))

  const firstFactor = async (email: string) => {
    const res = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
    ensure(res, 200, 'first factor')
    if (res.json.status !== 'mfa_required' || res.refreshCookie) {
      throw new Error(`first factor did not stop at the second: ${JSON.stringify(res.json)}`)
    }
    return res.json.mfaToken as string
  }

  test('setup shows the QR secret; enabling needs a correct code and returns ten recovery codes', async () => {
    const user = await signUp()
    const bad = await api('POST', '/api/account/two-factor/enable', {
      token: user.accessToken,
      body: { code: '123456' },
    })
    expect(bad.status).toBe(400)
    expect(bad.json.error.code).toBe('totp_not_started')

    const setup = await api('POST', '/api/account/two-factor/setup', { token: user.accessToken })
    const wrong = await api('POST', '/api/account/two-factor/enable', {
      token: user.accessToken,
      body: { code: '000000' },
    })
    expect(wrong.status).toBe(400)
    const ok = await api('POST', '/api/account/two-factor/enable', {
      token: user.accessToken,
      body: { code: totpCode(setup.json.secret, new Date()) },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.recoveryCodes).toHaveLength(10)
    const status = await api('GET', '/api/account/two-factor', { token: user.accessToken })
    expect(status.json).toEqual({ available: true, enabled: true, recoveryCodesRemaining: 10 })
  })

  test('a password sign-in then waits for the code, and the code works once', async () => {
    const user = await enrol()
    const mfaToken = await firstFactor(user.email)
    const code = nextCode(user.secret)

    const wrong = await api('POST', '/api/auth/mfa/verify', { body: { mfaToken, code: '000000' } })
    expect(wrong.status).toBe(401)
    expect(wrong.json.error.code).toBe('invalid_mfa_code')

    const ok = await api('POST', '/api/auth/mfa/verify', { body: { mfaToken, code } })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ status: 'authenticated', user: { email: user.email } })
    expect(ok.refreshCookie).toBeTruthy()

    // The same code again, on a new challenge, is a replay.
    const replay = await api('POST', '/api/auth/mfa/verify', {
      body: { mfaToken: await firstFactor(user.email), code },
    })
    expect(replay.status).toBe(401)
    // and the first challenge is spent
    const spent = await api('POST', '/api/auth/mfa/verify', { body: { mfaToken, code } })
    expect(spent.status).toBe(401)
    expect(spent.json.error.code).toBe('mfa_challenge_expired')
  })

  test('a magic link is followed by the code too; a passkey-free provider-free account has no way round it', async () => {
    const user = await enrol()
    const email = user.email
    ensure(await api('POST', '/api/auth/magic-link', { body: { email } }), 202, 'request')
    const mail = await waitForMail(email, 'sign-in')
    const res = await api('POST', '/api/auth/magic-link/verify', { body: { token: mail.token } })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('mfa_required')
    expect(res.refreshCookie).toBeUndefined()
  })

  test('five wrong codes close the challenge', async () => {
    const user = await enrol()
    const mfaToken = await firstFactor(user.email)
    for (let i = 0; i < 5; i++) {
      const res = await api('POST', '/api/auth/mfa/verify', { body: { mfaToken, code: '000000' } })
      expect(res.status).toBe(401)
    }
    const late = await api('POST', '/api/auth/mfa/verify', {
      body: { mfaToken, code: nextCode(user.secret) },
    })
    expect(late.status).toBe(401)
    expect(late.json.error.code).toBe('mfa_challenge_expired')
  })

  test('a recovery code signs in once', async () => {
    const user = await enrol()
    const code = user.recoveryCodes[0] as string
    const ok = await api('POST', '/api/auth/mfa/verify', {
      body: { mfaToken: await firstFactor(user.email), code },
    })
    expect(ok.status).toBe(200)
    const again = await api('POST', '/api/auth/mfa/verify', {
      body: { mfaToken: await firstFactor(user.email), code },
    })
    expect(again.status).toBe(401)
    const status = await api('GET', '/api/account/two-factor', { token: ok.json.accessToken })
    expect(status.json.recoveryCodesRemaining).toBe(9)
  })

  test('the app confirms sensitive actions, and turning it off needs a confirmation', async () => {
    const user = await enrol()
    const signedIn = await api('POST', '/api/auth/mfa/verify', {
      body: { mfaToken: await firstFactor(user.email), code: user.recoveryCodes[0] },
    })
    ensure(signedIn, 200, 'sign in')
    const refreshed = await api('POST', '/api/auth/refresh', { cookie: signedIn.refreshCookie })
    ensure(refreshed, 200, 'refresh')
    const stale = refreshed.json.accessToken as string

    const blocked = await api('DELETE', '/api/account/two-factor', { token: stale })
    expect(blocked.status).toBe(403)

    const wrong = await api('POST', '/api/account/step-up/totp', {
      token: stale,
      body: { code: '000000' },
    })
    expect(wrong.status).toBe(400)
    const elevated = await api('POST', '/api/account/step-up/totp', {
      token: stale,
      body: { code: nextCode(user.secret) },
    })
    expect(elevated.status).toBe(200)

    const fresh = await api('POST', '/api/account/two-factor/recovery-codes', {
      token: elevated.json.accessToken,
    })
    expect(fresh.status).toBe(200)
    expect(fresh.json.recoveryCodes).toHaveLength(10)

    const off = await api('DELETE', '/api/account/two-factor', { token: elevated.json.accessToken })
    expect(off.status).toBe(204)
    const plain = await api('POST', '/api/auth/login', {
      body: { email: user.email, password: PASSWORD },
    })
    expect(plain.json.status).toBe('authenticated')
  })
})

describe('who may create an account', () => {
  const quiet = async (email: string) => {
    await sleep(1200)
    return mailsTo(email)
  }

  test('closed: nobody new (the same 202, no mail); the allow-listed owner can still create the first', async () => {
    const owner = uniqueEmail('owner')
    const closed = await createTestApp(
      {},
      { REGISTRATION_MODE: 'closed', REGISTRATION_ALLOWED_EMAILS: owner },
    )
    try {
      const call = client(closed.app)
      const stranger = uniqueEmail('stranger')
      expect(
        (await call('POST', '/api/auth/magic-link', { body: { email: stranger } })).status,
      ).toBe(202)
      expect(
        (
          await call('POST', '/api/auth/register', {
            body: { email: stranger, password: PASSWORD },
          })
        ).status,
      ).toBe(202)
      expect(await quiet(stranger)).toHaveLength(0)

      const session = await login(call, owner)
      expect(session.userId).toBeTruthy()
      expect((await call('GET', '/api/auth/options')).json.registration).toBe('closed')
    } finally {
      await closed.container.close()
    }
  })

  test('invite-only: a member invites an address, which can then create its account', async () => {
    const owner = uniqueEmail('owner')
    const invite = await createTestApp(
      {},
      { REGISTRATION_MODE: 'invite', REGISTRATION_ALLOWED_EMAILS: owner },
    )
    try {
      const call = client(invite.app)
      const member = await login(call, owner)
      const friend = uniqueEmail('friend')
      const stranger = uniqueEmail('stranger')

      expect((await call('POST', '/api/auth/magic-link', { body: { email: friend } })).status).toBe(
        202,
      )
      expect(await quiet(friend)).toHaveLength(0)

      const sent = await call('POST', '/api/account/invitations', {
        token: member.accessToken,
        body: { email: friend },
      })
      expect(sent.status).toBe(201)
      expect(sent.json).toMatchObject({ email: friend, status: 'pending' })
      await waitForMail(friend, 'You are invited')
      const dup = await call('POST', '/api/account/invitations', {
        token: member.accessToken,
        body: { email: friend },
      })
      expect(dup.status).toBe(409)

      const joined = await login(call, friend)
      expect(joined.userId).toBeTruthy()
      const list = await call('GET', '/api/account/invitations', { token: member.accessToken })
      expect(list.json.invitations).toMatchObject([{ email: friend, status: 'accepted' }])

      expect(
        (await call('POST', '/api/auth/magic-link', { body: { email: stranger } })).status,
      ).toBe(202)
      expect(await quiet(stranger)).toHaveLength(0)
    } finally {
      await invite.container.close()
    }
  })

  test('invitations are not a thing where registration is open', async () => {
    const session = await login(api, uniqueEmail('member'))
    const res = await api('POST', '/api/account/invitations', {
      token: session.accessToken,
      body: { email: uniqueEmail('x') },
    })
    expect(res.status).toBe(404)
  })

  test('an email domain allow-list applies to every way in', async () => {
    const corp = await createTestApp({}, { REGISTRATION_EMAIL_DOMAINS: 'corp.example.test' })
    try {
      const call = client(corp.app)
      const outsider = uniqueEmail('outsider')
      expect(
        (await call('POST', '/api/auth/magic-link', { body: { email: outsider } })).status,
      ).toBe(202)
      expect(await quiet(outsider)).toHaveLength(0)
      const insider = `ada-${Date.now()}@corp.example.test`
      const session = await login(call, insider)
      expect(session.userId).toBeTruthy()
    } finally {
      await corp.container.close()
    }
  })

  test('terms: a new address stops at the sign-up form until they are accepted', async () => {
    const withTerms = await createTestApp(
      {},
      { TERMS_VERSION: '2026-01', TERMS_URL: 'https://example.test/terms' },
    )
    try {
      const call = client(withTerms.app)
      const options = await call('GET', '/api/auth/options')
      expect(options.json).toMatchObject({
        termsVersion: '2026-01',
        termsUrl: 'https://example.test/terms',
      })

      const email = uniqueEmail('terms')
      ensure(await call('POST', '/api/auth/magic-link', { body: { email } }), 202, 'request')
      const mail = await waitForMail(email, 'sign-in')
      const step = await call('POST', '/api/auth/magic-link/verify', {
        body: { token: mail.token },
      })
      expect(step.status).toBe(200)
      expect(step.json).toMatchObject({ status: 'signup_required', email, termsVersion: '2026-01' })
      expect(step.refreshCookie).toBeUndefined()

      const refused = await call('POST', '/api/auth/signup/complete', {
        body: { signupToken: step.json.signupToken, displayName: 'Ada Lovelace' },
      })
      expect(refused.status).toBe(400)
      expect(refused.json.error.code).toBe('terms_not_accepted')

      const done = await call('POST', '/api/auth/signup/complete', {
        body: {
          signupToken: step.json.signupToken,
          displayName: 'Ada Lovelace',
          acceptTerms: true,
        },
      })
      expect(done.status).toBe(200)
      expect(done.json).toMatchObject({ status: 'authenticated', user: { email } })

      // The profile is made from the registration event, a moment later.
      const me = await eventually(async () => {
        const res = await call('GET', '/api/me', { token: done.json.accessToken })
        return res.json?.version > 0 ? res.json : undefined
      })
      expect(me.displayName).toBe('Ada Lovelace')

      // a password sign-up must tick the box too
      const pw = await call('POST', '/api/auth/register', {
        body: { email: uniqueEmail('pw'), password: PASSWORD },
      })
      expect(pw.status).toBe(400)
      expect(pw.json.error.code).toBe('terms_not_accepted')
    } finally {
      await withTerms.container.close()
    }
  })
})
