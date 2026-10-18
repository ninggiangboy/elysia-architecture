import { afterEach, describe, expect, test } from 'bun:test'
import { ArcticOAuthGateway } from './oauth-gateway'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const REDIRECT = 'https://app.test/auth/oauth/callback'
const gateway = new ArcticOAuthGateway({
  redirectUri: REDIRECT,
  google: { clientId: 'google-id', clientSecret: 'google-secret' },
  github: { clientId: 'github-id', clientSecret: 'github-secret' },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** An unsigned JWT: the gateway reads the claims of an id_token fetched straight from Google, it does not check a signature. */
const idToken = (claims: Record<string, unknown>) =>
  ['{"alg":"RS256"}', JSON.stringify(claims), 'sig']
    .map((part, i) => (i === 2 ? part : Buffer.from(part).toString('base64url')))
    .join('.')

const fakeFetch = (routes: Record<string, (init?: RequestInit) => Response>) => {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, init })
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    if (!route) throw new Error(`unexpected request to ${url}`)
    return route[1](init)
  }) as typeof fetch
  return calls
}

describe('ArcticOAuthGateway', () => {
  test('only configured providers are enabled', () => {
    expect(gateway.enabledProviders()).toEqual(['google', 'github'])
    expect(new ArcticOAuthGateway({ redirectUri: REDIRECT }).enabledProviders()).toEqual([])
    const githubOnly = new ArcticOAuthGateway({
      redirectUri: REDIRECT,
      github: { clientId: 'i', clientSecret: 's' },
    })
    expect(githubOnly.enabledProviders()).toEqual(['github'])
    expect(() => githubOnly.authorizationUrl('google', { state: 's', codeVerifier: 'v' })).toThrow()
    expect(githubOnly.providerNames()).toEqual({ github: 'GitHub' })
  })

  test('authorization URLs carry state, the redirect URI and, for Google, a PKCE challenge', async () => {
    const google = new URL(
      await gateway.authorizationUrl('google', { state: 'st', codeVerifier: 'v'.repeat(43) }),
    )
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(google.searchParams.get('state')).toBe('st')
    expect(google.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(google.searchParams.get('code_challenge_method')).toBe('S256')
    expect(google.searchParams.get('scope')).toContain('email')

    const github = new URL(
      await gateway.authorizationUrl('github', { state: 'st', codeVerifier: 'v' }),
    )
    expect(github.origin + github.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(github.searchParams.get('state')).toBe('st')
    expect(github.searchParams.get('scope')).toBe('user:email')
  })

  describe('Google', () => {
    const exchange = (claims: Record<string, unknown>) => {
      fakeFetch({
        'https://oauth2.googleapis.com/token': () =>
          json({ access_token: 'at', token_type: 'Bearer', id_token: idToken(claims) }),
      })
      return gateway.exchange('google', { code: 'c', codeVerifier: 'v' })
    }
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'google-id',
      sub: '1234',
      email: 'a@example.com',
      email_verified: true,
    }

    test('reads the profile from the id_token', async () => {
      expect(await exchange(claims)).toEqual({
        providerUserId: '1234',
        email: 'a@example.com',
        emailVerified: true,
        displayName: null,
      })
    })

    test('an email Google does not vouch for is never treated as verified', async () => {
      expect((await exchange({ ...claims, email_verified: false }))?.emailVerified).toBe(false)
      expect((await exchange({ ...claims, email_verified: 'true' }))?.emailVerified).toBe(false)
      const noEmail = await exchange({ ...claims, email: undefined, email_verified: undefined })
      expect(noEmail).toMatchObject({ email: null, emailVerified: false })
    })

    test('a token issued to another app or by another issuer is refused', async () => {
      expect(await exchange({ ...claims, aud: 'someone-elses-app' })).toBeNull()
      expect(await exchange({ ...claims, iss: 'https://evil.example' })).toBeNull()
      expect(await exchange({ ...claims, sub: undefined })).toBeNull()
    })

    test('a code Google rejects is a null result, not a crash', async () => {
      fakeFetch({
        'https://oauth2.googleapis.com/token': () => json({ error: 'invalid_grant' }, 400),
      })
      expect(await gateway.exchange('google', { code: 'used', codeVerifier: 'v' })).toBeNull()
    })
  })

  describe('GitHub', () => {
    const api = (user: unknown, emails: unknown) =>
      fakeFetch({
        'https://github.com/login/oauth/access_token': () =>
          json({ access_token: 'gh-token', token_type: 'bearer' }),
        'https://api.github.com/user/emails': () => json(emails),
        'https://api.github.com/user': () => json(user),
      })

    test('uses the verified primary email, not the one typed into the profile', async () => {
      const calls = api({ id: 42, email: 'typed-by-user@example.com' }, [
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'main@example.com', primary: true, verified: true },
      ])
      expect(await gateway.exchange('github', { code: 'c', codeVerifier: 'v' })).toEqual({
        providerUserId: '42',
        email: 'main@example.com',
        emailVerified: true,
        displayName: null,
      })
      const emailsCall = calls.find((c) => c.url.endsWith('/user/emails'))
      expect(new Headers(emailsCall?.init?.headers).get('authorization')).toBe('Bearer gh-token')
    })

    test('an unverified primary email (or none) means no verified email', async () => {
      api({ id: 7 }, [{ email: 'unverified@example.com', primary: true, verified: false }])
      expect(await gateway.exchange('github', { code: 'c', codeVerifier: 'v' })).toEqual({
        providerUserId: '7',
        email: null,
        emailVerified: false,
        displayName: null,
      })
    })

    test('a code GitHub rejects is a null result', async () => {
      fakeFetch({
        'https://github.com/login/oauth/access_token': () =>
          json({ error: 'bad_verification_code' }),
      })
      expect(await gateway.exchange('github', { code: 'used', codeVerifier: 'v' })).toBeNull()
    })

    test('a provider outage is an error, not a silent sign-in refusal', async () => {
      fakeFetch({
        'https://github.com/login/oauth/access_token': () => json({ access_token: 't' }),
        'https://api.github.com/user': () => new Response('boom', { status: 502 }),
      })
      await expect(gateway.exchange('github', { code: 'c', codeVerifier: 'v' })).rejects.toThrow(
        '502',
      )
    })
  })

  describe('Microsoft', () => {
    const ms = new ArcticOAuthGateway({
      redirectUri: REDIRECT,
      microsoft: { clientId: 'ms-id', clientSecret: 's', tenant: 'common' },
    })
    const TENANT = 'a1b2c3d4-0000-0000-0000-000000000000'
    const exchange = (claims: Record<string, unknown>) => {
      fakeFetch({
        'https://login.microsoftonline.com/common/oauth2/v2.0/token': () =>
          json({ access_token: 'at', token_type: 'Bearer', id_token: idToken(claims) }),
      })
      return ms.exchange('microsoft', { code: 'c', codeVerifier: 'v' })
    }
    const claims = {
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      aud: 'ms-id',
      sub: 'ms-sub',
      tid: TENANT,
      email: 'a@corp.example',
      name: 'Ada',
    }

    test('a work account is verified only when Microsoft says the tenant owns the domain', async () => {
      expect((await exchange(claims))?.emailVerified).toBe(false)
      expect((await exchange({ ...claims, xms_edov: true }))?.emailVerified).toBe(true)
      expect((await exchange({ ...claims, xms_edov: false }))?.emailVerified).toBe(false)
    })

    test('a personal account’s address is verified by Microsoft itself', async () => {
      const tid = '9188040d-6c67-4c5b-b112-36a304b66dad'
      const profile = await exchange({
        ...claims,
        tid,
        iss: `https://login.microsoftonline.com/${tid}/v2.0`,
      })
      expect(profile).toMatchObject({ emailVerified: true, displayName: 'Ada' })
    })

    test('a token for another app or from a mismatched issuer is refused', async () => {
      expect(await exchange({ ...claims, aud: 'other' })).toBeNull()
      expect(
        await exchange({ ...claims, iss: 'https://login.microsoftonline.com/x/v2.0' }),
      ).toBeNull()
    })
  })

  describe('Discord', () => {
    const discord = new ArcticOAuthGateway({
      redirectUri: REDIRECT,
      discord: { clientId: 'dc-id', clientSecret: 's' },
    })
    const api = (user: unknown) =>
      fakeFetch({
        'https://discord.com/api/oauth2/token': () =>
          json({ access_token: 'dc-token', token_type: 'Bearer' }),
        'https://discord.com/api/users/@me': () => json(user),
      })

    test('uses the verified flag Discord reports', async () => {
      api({ id: '9', email: 'a@example.com', verified: true, global_name: 'Ada' })
      expect(await discord.exchange('discord', { code: 'c', codeVerifier: 'v' })).toEqual({
        providerUserId: '9',
        email: 'a@example.com',
        emailVerified: true,
        displayName: 'Ada',
      })
      api({ id: '9', email: 'a@example.com', verified: false, username: 'ada' })
      expect(
        (await discord.exchange('discord', { code: 'c', codeVerifier: 'v' }))?.emailVerified,
      ).toBe(false)
    })
  })

  describe('generic OIDC', () => {
    const ISSUER = 'https://sso.example.com/realms/acme'
    const oidc = () =>
      new ArcticOAuthGateway({
        redirectUri: REDIRECT,
        oidc: [
          { id: 'acme', name: 'Acme SSO', issuer: ISSUER, clientId: 'acme-id', clientSecret: 's' },
        ],
      })
    const discovery = (doc: Record<string, unknown> = {}) => ({
      [`${ISSUER}/.well-known/openid-configuration`]: () =>
        json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/auth`,
          token_endpoint: `${ISSUER}/token`,
          ...doc,
        }),
    })

    test('endpoints come from the discovery document, with PKCE', async () => {
      fakeFetch(discovery())
      const gw = oidc()
      expect(gw.enabledProviders()).toEqual(['acme'])
      expect(gw.providerNames()).toEqual({ acme: 'Acme SSO' })
      const url = new URL(
        await gw.authorizationUrl('acme', { state: 'st', codeVerifier: 'v'.repeat(43) }),
      )
      expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`)
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('client_id')).toBe('acme-id')
    })

    test('a discovery document for another issuer is refused', async () => {
      fakeFetch(discovery({ issuer: 'https://evil.example' }))
      await expect(
        oidc().authorizationUrl('acme', { state: 's', codeVerifier: 'v' }),
      ).rejects.toThrow('another issuer')
    })

    test('reads the profile, and only a boolean email_verified counts', async () => {
      const claims = { iss: ISSUER, aud: 'acme-id', sub: 'u1', email: 'a@example.com', name: 'Ada' }
      const exchange = (extra: Record<string, unknown>) => {
        fakeFetch({
          ...discovery(),
          [`${ISSUER}/token`]: () =>
            json({
              access_token: 'at',
              token_type: 'Bearer',
              id_token: idToken({ ...claims, ...extra }),
            }),
        })
        return oidc().exchange('acme', { code: 'c', codeVerifier: 'v' })
      }
      expect(await exchange({ email_verified: true })).toEqual({
        providerUserId: 'u1',
        email: 'a@example.com',
        emailVerified: true,
        displayName: 'Ada',
      })
      expect((await exchange({ email_verified: 'true' }))?.emailVerified).toBe(false)
      expect((await exchange({}))?.emailVerified).toBe(false)
      expect(await exchange({ aud: 'someone-else' })).toBeNull()
      expect(await exchange({ iss: 'https://evil.example' })).toBeNull()
    })
  })
})
