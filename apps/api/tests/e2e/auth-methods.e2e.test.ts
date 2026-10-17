import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { decodeJwt } from 'jose'
import type { OAuthGateway, OAuthProfile } from '#/modules/identity/application/ports'
import type { OAuthProviderId } from '#/modules/identity/domain/oauth-account'
import {
  client,
  createTestApp,
  eventually,
  login,
  mailsTo,
  type TestApp,
  uniqueEmail,
  uniqueIp,
  waitForMail,
} from './helpers'
import { SoftwareAuthenticator } from './software-authenticator'

/** Google/GitHub stand-in: a test registers the profile a `code` will resolve to. */
class FakeOAuthGateway implements OAuthGateway {
  private profiles = new Map<string, OAuthProfile>()
  enabledProviders(): OAuthProviderId[] {
    return ['google', 'github']
  }
  authorizationUrl(provider: OAuthProviderId, p: { state: string; codeVerifier: string }) {
    return `https://idp.test/${provider}/authorize?state=${p.state}&verifier_len=${p.codeVerifier.length}`
  }
  async exchange(_provider: OAuthProviderId, p: { code: string; codeVerifier: string }) {
    return this.profiles.get(p.code) ?? null
  }
  /** The `code` the "provider" will accept, and the person it stands for. */
  code(name: string, profile: OAuthProfile) {
    this.profiles.set(name, profile)
    return name
  }
}

let t: TestApp
let api: ReturnType<typeof client>
const idp = new FakeOAuthGateway()
let origin: string
let rpId: string

beforeAll(async () => {
  t = await createTestApp({ oauth: idp })
  api = client(t.app)
  origin = t.config.WEBAUTHN_ORIGINS[0] as string
  rpId = t.config.WEBAUTHN_RP_ID
})

afterAll(async () => {
  await t.container.close()
})

const authenticator = (behaviour: ConstructorParameters<typeof SoftwareAuthenticator>[1] = {}) =>
  new SoftwareAuthenticator({ rpId, origin }, behaviour)

/** A session whose access token no longer counts as a recent confirmation (what a plain refresh gives). */
async function staleSession(email = uniqueEmail('stale')) {
  const session = await login(api, email)
  const refreshed = await api('POST', '/api/auth/refresh', { cookie: session.cookie })
  ensure(refreshed, 200, 'refresh')
  if (decodeJwt(refreshed.json.accessToken).auth_time !== undefined) {
    throw new Error('a refreshed access token must not count as a recent confirmation')
  }
  return {
    ...session,
    email,
    accessToken: refreshed.json.accessToken as string,
    cookie: refreshed.refreshCookie as string,
  }
}

/** Setup steps fail loudly with the response, instead of asserting outside a test. */
function ensure(res: { status: number; json?: unknown }, status: number, step: string) {
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status} ${JSON.stringify(res.json)}`)
  }
}

const codeFrom = (subject: string) => subject.match(/\d{6}/)?.[0] as string

/** Confirms with an emailed code; returns the elevated access token. */
async function confirmWithEmail(session: { accessToken: string; email: string }) {
  const sent = await api('POST', '/api/account/step-up/email-code', { token: session.accessToken })
  ensure(sent, 202, 'request code')
  const mail = await waitForMail(session.email, 'confirmation code')
  const verified = await api('POST', '/api/account/step-up/email-code/verify', {
    token: session.accessToken,
    body: { code: codeFrom(mail.subject) },
  })
  ensure(verified, 200, 'verify code')
  return verified.json.accessToken as string
}

async function addPasskey(token: string, key: SoftwareAuthenticator, name?: string) {
  const begin = await api('POST', '/api/account/passkeys/options', { token })
  ensure(begin, 200, 'passkey options')
  return api('POST', '/api/account/passkeys', {
    token,
    body: { challengeId: begin.json.challengeId, response: key.create(begin.json.options), name },
  })
}

async function loginWithPasskey(key: SoftwareAuthenticator, overrides = {}) {
  const begin = await api('POST', '/api/auth/passkey/options')
  ensure(begin, 200, 'passkey login options')
  return api('POST', '/api/auth/passkey/verify', {
    body: { challengeId: begin.json.challengeId, response: key.get(begin.json.options, overrides) },
  })
}

describe('step-up (recent confirmation)', () => {
  test('signing in counts as a confirmation, a plain refresh does not', async () => {
    const session = await login(api, uniqueEmail('fresh'))
    expect(decodeJwt(session.accessToken).auth_time).toBeGreaterThan(Date.now() / 1000 - 30)

    const fresh = await api('POST', '/api/account/email-change', {
      token: session.accessToken,
      body: { newEmail: uniqueEmail('target') },
    })
    expect(fresh.status).toBe(202)

    const stale = await staleSession()
    const blocked = await api('POST', '/api/account/email-change', {
      token: stale.accessToken,
      body: { newEmail: uniqueEmail('target') },
    })
    expect(blocked.status).toBe(403)
    expect(blocked.json.error.code).toBe('step_up_required')
  })

  test('an emailed code elevates the session; wrong guesses are limited', async () => {
    const stale = await staleSession()
    const elevated = await confirmWithEmail(stale)
    expect(decodeJwt(elevated).sid).toBe(decodeJwt(stale.accessToken).sid)
    const ok = await api('POST', '/api/account/email-change', {
      token: elevated,
      body: { newEmail: uniqueEmail('target') },
    })
    expect(ok.status).toBe(202)

    // Five wrong guesses burn the pending code — even the right one is refused afterwards.
    const second = await staleSession()
    await api('POST', '/api/account/step-up/email-code', { token: second.accessToken })
    const right = codeFrom((await waitForMail(second.email, 'confirmation code')).subject)
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      const bad = await api('POST', '/api/account/step-up/email-code/verify', {
        token: second.accessToken,
        body: { code: wrong },
      })
      expect(bad.status).toBe(400)
      expect(bad.json.error.code).toBe('invalid_step_up_code')
    }
    const locked = await api('POST', '/api/account/step-up/email-code/verify', {
      token: second.accessToken,
      body: { code: right },
    })
    expect(locked.status).toBe(400)
  })

  test('a code works once, a newer code replaces the older one, and requests are rate limited', async () => {
    const stale = await staleSession()
    const mailed = async (n: number) =>
      eventually(async () => {
        const mails = (await mailsTo(stale.email)).filter((m) => m.Subject.includes('confirmation'))
        return mails.length >= n ? mails : undefined
      })

    await api('POST', '/api/account/step-up/email-code', { token: stale.accessToken })
    const [firstMail] = await mailed(1)
    const first = codeFrom(firstMail?.Subject ?? '')
    await api('POST', '/api/account/step-up/email-code', { token: stale.accessToken })
    const [latestMail] = await mailed(2)
    const latest = codeFrom(latestMail?.Subject ?? '')

    if (first !== latest) {
      const old = await api('POST', '/api/account/step-up/email-code/verify', {
        token: stale.accessToken,
        body: { code: first },
      })
      expect(old.status).toBe(400)
    }
    const verify = () =>
      api('POST', '/api/account/step-up/email-code/verify', {
        token: stale.accessToken,
        body: { code: ` ${latest.slice(0, 3)} ${latest.slice(3)} ` }, // pasted with spaces
      })
    expect((await verify()).status).toBe(200)
    expect((await verify()).status).toBe(400)

    let last = { status: 202, headers: new Headers() }
    for (let i = 0; i < 6 && last.status === 202; i++) {
      last = await api('POST', '/api/account/step-up/email-code', { token: stale.accessToken })
    }
    expect(last.status).toBe(429)
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  test('the endpoints need a signed-in user', async () => {
    expect((await api('POST', '/api/account/step-up/email-code')).status).toBe(401)
    expect((await api('POST', '/api/account/passkeys/options')).status).toBe(401)
  })
})

describe('passkeys', () => {
  test('register, sign in without an email, and manage passkeys', async () => {
    const email = uniqueEmail('passkey')
    const session = await login(api, email)
    const key = authenticator()

    const added = await addPasskey(session.accessToken, key, '  MacBook  ')
    expect(added.status).toBe(201)
    expect(added.json.name).toBe('MacBook')
    expect(added.json.lastUsedAt).toBeNull()

    const listed = await api('GET', '/api/account/passkeys', { token: session.accessToken })
    expect(listed.json.passkeys.map((p: { name: string }) => p.name)).toEqual(['MacBook'])

    // The same authenticator again is turned down.
    const again = await addPasskey(session.accessToken, key)
    expect(again.status).toBe(409)

    const signedIn = await loginWithPasskey(key)
    expect(signedIn.status).toBe(200)
    expect(signedIn.json.user.email).toBe(email)
    expect(signedIn.refreshCookie).toBeDefined()
    expect(decodeJwt(signedIn.json.accessToken).auth_time).toBeDefined()
    const me = await api('GET', '/api/me', { token: signedIn.json.accessToken })
    expect(me.json.email).toBe(email)

    const after = await api('GET', '/api/account/passkeys', { token: session.accessToken })
    expect(after.json.passkeys[0].lastUsedAt).not.toBeNull()

    // The account is told about the new way in.
    const notification = await eventually(async () => {
      const res = await api('GET', '/api/notifications', { token: session.accessToken })
      return res.json.items?.find((n: { template: string }) => n.template === 'passkeyAdded')
    })
    expect(notification.kind).toBe('security_alert')
  })

  test('adding a passkey needs a recent confirmation', async () => {
    const stale = await staleSession()
    const denied = await api('POST', '/api/account/passkeys/options', { token: stale.accessToken })
    expect(denied.status).toBe(403)
    expect(denied.json.error.code).toBe('step_up_required')

    const elevated = await confirmWithEmail(stale)
    expect((await addPasskey(elevated, authenticator())).status).toBe(201)
  })

  test('a challenge is single use and bound to the ceremony it was made for', async () => {
    const session = await login(api, uniqueEmail('replay'))
    const key = authenticator()
    await addPasskey(session.accessToken, key)

    const begin = await api('POST', '/api/auth/passkey/options')
    const assertion = key.get(begin.json.options)
    const first = await api('POST', '/api/auth/passkey/verify', {
      body: { challengeId: begin.json.challengeId, response: assertion },
    })
    expect(first.status).toBe(200)
    const replay = await api('POST', '/api/auth/passkey/verify', {
      body: { challengeId: begin.json.challengeId, response: assertion },
    })
    expect(replay.status).toBe(400)
    expect(replay.json.error.code).toBe('invalid_passkey_challenge')

    // A registration challenge cannot be used to sign in.
    const reg = await api('POST', '/api/account/passkeys/options', { token: session.accessToken })
    const crossed = await api('POST', '/api/auth/passkey/verify', {
      body: { challengeId: reg.json.challengeId, response: key.get(reg.json.options) },
    })
    expect(crossed.status).toBe(400)
  })

  test('rejects the wrong origin, an unknown key and a regressed counter', async () => {
    const session = await login(api, uniqueEmail('reject'))
    const key = authenticator()
    await addPasskey(session.accessToken, key)

    const phishing = await loginWithPasskey(key, { origin: 'https://evil.example' })
    expect(phishing.status).toBe(401)
    expect(phishing.json.error.code).toBe('passkey_rejected')

    const stranger = await loginWithPasskey(authenticator())
    expect(stranger.status).toBe(401)
    expect(stranger.json.error.code).toBe('passkey_not_recognized')

    expect((await loginWithPasskey(key, { counter: 10 })).status).toBe(200)
    const cloned = await loginWithPasskey(key, { counter: 5 })
    expect(cloned.status).toBe(401)
    // The library refuses a counter that went backwards before our own check (a second line of defence) is reached.
    expect(cloned.json.error.code).toBe('passkey_rejected')
  })

  test('a registration without user verification is refused', async () => {
    const session = await login(api, uniqueEmail('uv'))
    const added = await addPasskey(session.accessToken, authenticator({ userVerified: false }))
    expect(added.status).toBe(400)
    expect(added.json.error.code).toBe('passkey_verification_failed')
  })

  test('synced passkeys (counter always 0) keep working', async () => {
    const session = await login(api, uniqueEmail('synced'))
    const key = authenticator({ syncedPasskey: true })
    await addPasskey(session.accessToken, key)
    expect((await loginWithPasskey(key)).status).toBe(200)
    expect((await loginWithPasskey(key)).status).toBe(200)
    const listed = await api('GET', '/api/account/passkeys', { token: session.accessToken })
    expect(listed.json.passkeys[0].backedUp).toBe(true)
    expect(listed.json.passkeys[0].deviceType).toBe('multiDevice')
  })

  test('confirm a sensitive action with a passkey, then remove it', async () => {
    const first = await login(api, uniqueEmail('stepup-pk'))
    const key = authenticator()
    const added = await addPasskey(first.accessToken, key)
    const refreshed = await api('POST', '/api/auth/refresh', { cookie: first.cookie })
    const token = refreshed.json.accessToken as string

    const denied = await api('DELETE', `/api/account/passkeys/${added.json.id}`, { token })
    expect(denied.status).toBe(403)

    // Another user's passkey cannot confirm.
    const begin = await api('POST', '/api/account/step-up/passkey/options', { token })
    expect(begin.status).toBe(200)
    const intruder = authenticator()
    const other = await login(api, uniqueEmail('other'))
    await addPasskey(other.accessToken, intruder)
    const wrongOwner = await api('POST', '/api/account/step-up/passkey/verify', {
      token,
      body: { challengeId: begin.json.challengeId, response: intruder.get(begin.json.options) },
    })
    expect(wrongOwner.status).toBe(401)

    const again = await api('POST', '/api/account/step-up/passkey/options', { token })
    const confirmed = await api('POST', '/api/account/step-up/passkey/verify', {
      token,
      body: { challengeId: again.json.challengeId, response: key.get(again.json.options) },
    })
    expect(confirmed.status).toBe(200)
    const elevated = confirmed.json.accessToken as string
    expect(decodeJwt(elevated).auth_time).toBeDefined()

    const remove = () =>
      api('DELETE', `/api/account/passkeys/${added.json.id}`, { token: elevated })
    expect((await remove()).status).toBe(204)
    expect((await remove()).status).toBe(404)
    expect((await loginWithPasskey(key)).status).toBe(401)
  })

  test('step-up with a passkey needs at least one passkey', async () => {
    const session = await login(api, uniqueEmail('nopk'))
    const res = await api('POST', '/api/account/step-up/passkey/options', {
      token: session.accessToken,
    })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('no_passkeys')
  })

  test("one user cannot remove another user's passkey", async () => {
    const owner = await login(api, uniqueEmail('owner'))
    const added = await addPasskey(owner.accessToken, authenticator())
    const other = await login(api, uniqueEmail('other'))
    const res = await api('DELETE', `/api/account/passkeys/${added.json.id}`, {
      token: other.accessToken,
    })
    expect(res.status).toBe(404)
  })
})

describe('OAuth', () => {
  const start = (provider: string, token?: string) =>
    api(
      'POST',
      token ? `/api/account/oauth/${provider}/link` : `/api/auth/oauth/${provider}/start`,
      { token },
    )
  const stateOf = (url: string) => new URL(url).searchParams.get('state') as string
  const complete = (state: string, code: string, token?: string) =>
    api('POST', '/api/auth/oauth/callback', { token, body: { state, code }, ip: uniqueIp() })
  const flow = async (provider: string, code: string, token?: string) =>
    complete(stateOf((await start(provider, token)).json.url), code, token)

  test('lists the enabled providers', async () => {
    const res = await api('GET', '/api/auth/oauth/providers')
    expect(res.json.providers).toEqual(['google', 'github'])
    expect((await start('myspace')).status).toBe(404)
  })

  test('first sign-in creates the account, the next one finds it', async () => {
    const email = uniqueEmail('google')
    const code = idp.code(`c-${email}`, {
      providerUserId: `g-${email}`,
      email,
      emailVerified: true,
    })

    const begin = await start('google')
    expect(begin.status).toBe(200)
    const state = stateOf(begin.json.url)
    const done = await complete(state, code)
    expect(done.status).toBe(200)
    expect(done.json.purpose).toBe('login')
    expect(done.json.user.email).toBe(email)
    expect(done.refreshCookie).toBeDefined()
    expect(decodeJwt(done.json.accessToken).auth_time).toBeDefined()
    await waitForMail(email, 'Welcome')

    // The state is single use.
    expect((await complete(state, code)).status).toBe(400)

    const again = await flow('google', code)
    expect(again.json.user.id).toBe(done.json.user.id)
  })

  test('a verified email matches an existing account and links to it; the owner is told', async () => {
    const email = uniqueEmail('both')
    const existing = await login(api, email)
    const code = idp.code(`c-${email}`, {
      providerUserId: `gh-${email}`,
      email,
      emailVerified: true,
    })

    const done = await flow('github', code)
    expect(done.status).toBe(200)
    expect(done.json.user.id).toBe(existing.userId)

    const accounts = await api('GET', '/api/account/oauth', { token: existing.accessToken })
    expect(accounts.json.accounts.map((a: { provider: string }) => a.provider)).toEqual(['github'])
    await eventually(async () => {
      const res = await api('GET', '/api/notifications', { token: existing.accessToken })
      return res.json.items?.find(
        (n: { template: string; data: { provider?: string } }) =>
          n.template === 'oauthLinked' && n.data.provider === 'github',
      )
    })
  })

  test('an unverified or missing email never signs in or takes over an account', async () => {
    const victim = uniqueEmail('victim')
    await login(api, victim)
    const unverified = idp.code('c-unverified', {
      providerUserId: 'attacker-1',
      email: victim,
      emailVerified: false,
    })
    const res = await flow('github', unverified)
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('oauth_email_unverified')

    const noEmail = idp.code('c-noemail', {
      providerUserId: 'attacker-2',
      email: null,
      emailVerified: false,
    })
    expect((await flow('github', noEmail)).status).toBe(400)

    const rejected = await flow('google', 'code-the-provider-refuses')
    expect(rejected.status).toBe(400)
    expect(rejected.json.error.code).toBe('oauth_exchange_failed')
    expect((await complete('made-up-state', 'whatever')).json.error.code).toBe(
      'invalid_oauth_state',
    )
  })

  test('connect and disconnect need a recent confirmation', async () => {
    const stale = await staleSession()
    expect((await start('google', stale.accessToken)).status).toBe(403)

    const elevated = await confirmWithEmail(stale)
    const profileEmail = uniqueEmail('personal-gmail')
    const code = idp.code(`c-${profileEmail}`, {
      providerUserId: `g-${profileEmail}`,
      email: profileEmail,
      emailVerified: true,
    })
    const linked = await flow('google', code, elevated)
    expect(linked.status).toBe(200)
    expect(linked.json).toEqual({ purpose: 'link', provider: 'google', email: profileEmail })

    // Signing in with the connected account lands in the same user, whatever its own email says.
    expect((await flow('google', code)).json.user.id).toBe(stale.userId)

    const remove = (token: string) => api('DELETE', '/api/account/oauth/google', { token })
    expect((await remove(stale.accessToken)).status).toBe(403)
    expect((await remove(elevated)).status).toBe(204)
    expect((await remove(elevated)).status).toBe(404)
    // The connection is really gone: the same Google account now creates a separate user.
    expect((await flow('google', code)).json.user.id).not.toBe(stale.userId)
  })

  test('only the user who started connecting can finish it', async () => {
    const alice = await login(api, uniqueEmail('alice'))
    const mallory = await login(api, uniqueEmail('mallory'))
    const victim = uniqueEmail('victim-gh')
    const code = idp.code(`c-${victim}`, {
      providerUserId: victim,
      email: uniqueEmail('x'),
      emailVerified: true,
    })

    // No token, or someone else's token, must not attach anything.
    const state = stateOf((await start('github', alice.accessToken)).json.url)
    const anonymous = await complete(state, code)
    expect(anonymous.status).toBe(403)
    expect(anonymous.json.error.code).toBe('oauth_state_mismatch')

    const second = stateOf((await start('github', alice.accessToken)).json.url)
    expect((await complete(second, code, mallory.accessToken)).status).toBe(403)
    const accounts = await api('GET', '/api/account/oauth', { token: mallory.accessToken })
    expect(accounts.json.accounts).toEqual([])
  })

  test('an account already connected elsewhere cannot be connected again', async () => {
    const owner = await login(api, uniqueEmail('owner-oauth'))
    const shared = uniqueEmail('shared-gh')
    const code = idp.code(`c-${shared}`, {
      providerUserId: shared,
      email: uniqueEmail('shared'),
      emailVerified: true,
    })
    expect((await flow('github', code, owner.accessToken)).status).toBe(200)

    const other = await login(api, uniqueEmail('other-oauth'))
    const res = await flow('github', code, other.accessToken)
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('oauth_account_taken')
  })
})
