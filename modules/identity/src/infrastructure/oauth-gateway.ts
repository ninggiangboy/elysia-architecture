import {
  CodeChallengeMethod,
  Discord,
  decodeIdToken,
  GitHub,
  Google,
  MicrosoftEntraId,
  OAuth2Client,
  OAuth2RequestError,
} from 'arctic'
import type { OAuthGateway, OAuthProfile } from '../application/ports'
import type { OAuthProviderId } from '../domain/oauth-account'

interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

interface OidcProviderOptions extends OAuthCredentials {
  id: string
  name: string
  /** The issuer URL; endpoints come from `<issuer>/.well-known/openid-configuration`. */
  issuer: string
  scopes?: string[]
}

export interface OAuthGatewayOptions {
  /** Where providers send the browser back — a page of the web app, which forwards `code` and `state` to the API. */
  redirectUri: string
  google?: OAuthCredentials
  github?: OAuthCredentials
  microsoft?: OAuthCredentials & { tenant: string }
  discord?: OAuthCredentials
  oidc?: OidcProviderOptions[]
}

type Params = { state: string; codeVerifier: string }

/** One sign-in provider: where to send the browser, and who the code it comes back with belongs to. */
interface Provider {
  name: string
  authorizationUrl(params: Params): string | Promise<string>
  /** null when the provider answers with something we cannot trust (wrong audience, no subject). */
  exchange(params: { code: string; codeVerifier: string }): Promise<OAuthProfile | null>
}

const GITHUB_API = 'https://api.github.com'
const DISCORD_API = 'https://discord.com/api'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
/** Microsoft's tenant id for personal accounts; their addresses are real mailboxes Microsoft verified. */
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

const audienceOf = (aud: string | string[] | undefined) => [aud ?? []].flat()

interface IdClaims {
  iss?: string
  aud?: string | string[]
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
}

/** Authorization-code flow against the providers, built on `arctic`. A provider is on only when it is configured. */
export class ArcticOAuthGateway implements OAuthGateway {
  private providers = new Map<OAuthProviderId, Provider>()

  constructor(options: OAuthGatewayOptions) {
    const { redirectUri } = options
    if (options.google) this.providers.set('google', googleProvider(options.google, redirectUri))
    if (options.github) this.providers.set('github', githubProvider(options.github, redirectUri))
    if (options.microsoft) {
      this.providers.set('microsoft', microsoftProvider(options.microsoft, redirectUri))
    }
    if (options.discord)
      this.providers.set('discord', discordProvider(options.discord, redirectUri))
    for (const oidc of options.oidc ?? []) {
      this.providers.set(oidc.id, new OidcProvider(oidc, redirectUri))
    }
  }

  enabledProviders(): OAuthProviderId[] {
    return [...this.providers.keys()]
  }

  providerNames(): Record<OAuthProviderId, string> {
    return Object.fromEntries([...this.providers].map(([id, p]) => [id, p.name]))
  }

  authorizationUrl(provider: OAuthProviderId, params: Params): string | Promise<string> {
    return this.get(provider).authorizationUrl(params)
  }

  async exchange(
    provider: OAuthProviderId,
    params: { code: string; codeVerifier: string },
  ): Promise<OAuthProfile | null> {
    try {
      return await this.get(provider).exchange(params)
    } catch (err) {
      // The provider said no (expired / reused code, wrong verifier). Anything else is a real failure.
      if (err instanceof OAuth2RequestError) return null
      throw err
    }
  }

  private get(provider: OAuthProviderId): Provider {
    const found = this.providers.get(provider)
    if (!found) throw new Error(`OAuth provider ${provider} is not configured`)
    return found
  }
}

function googleProvider(
  { clientId, clientSecret }: OAuthCredentials,
  redirectUri: string,
): Provider {
  const client = new Google(clientId, clientSecret, redirectUri)
  return {
    name: 'Google',
    authorizationUrl: (p) =>
      client
        .createAuthorizationURL(p.state, p.codeVerifier, ['openid', 'email', 'profile'])
        .toString(),
    async exchange(p) {
      const tokens = await client.validateAuthorizationCode(p.code, p.codeVerifier)
      // The id_token came straight from Google's token endpoint over TLS, so it is not re-verified by signature
      // (OIDC Core §3.1.3.7), but it must still be meant for us.
      const claims = decodeIdToken(tokens.idToken()) as IdClaims
      if (!claims.sub || !claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) return null
      if (!audienceOf(claims.aud).includes(clientId)) return null
      return {
        providerUserId: claims.sub,
        email: claims.email ?? null,
        emailVerified: claims.email_verified === true,
        displayName: claims.name ?? null,
      }
    },
  }
}

function githubProvider(
  { clientId, clientSecret }: OAuthCredentials,
  redirectUri: string,
): Provider {
  const client = new GitHub(clientId, clientSecret, redirectUri)
  return {
    name: 'GitHub',
    authorizationUrl: (p) => client.createAuthorizationURL(p.state, ['user:email']).toString(),
    async exchange(p) {
      const tokens = await client.validateAuthorizationCode(p.code)
      const headers = {
        authorization: `Bearer ${tokens.accessToken()}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'elysia-architecture',
      }
      const userRes = await fetch(`${GITHUB_API}/user`, { headers })
      if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`)
      const user = (await userRes.json()) as { id?: number; name?: string | null; login?: string }
      if (typeof user.id !== 'number') return null

      // The profile email is whatever the user typed and may be unverified; only a verified primary address counts.
      const emailsRes = await fetch(`${GITHUB_API}/user/emails`, { headers })
      if (!emailsRes.ok) throw new Error(`GitHub /user/emails failed: ${emailsRes.status}`)
      const emails = (await emailsRes.json()) as {
        email: string
        primary: boolean
        verified: boolean
      }[]
      const primary = emails.find((e) => e.primary && e.verified)
      return {
        providerUserId: String(user.id),
        email: primary?.email ?? null,
        emailVerified: primary !== undefined,
        displayName: user.name ?? user.login ?? null,
      }
    },
  }
}

function microsoftProvider(
  { clientId, clientSecret, tenant }: OAuthCredentials & { tenant: string },
  redirectUri: string,
): Provider {
  const client = new MicrosoftEntraId(tenant, clientId, clientSecret, redirectUri)
  return {
    name: 'Microsoft',
    authorizationUrl: (p) =>
      client
        .createAuthorizationURL(p.state, p.codeVerifier, ['openid', 'profile', 'email'])
        .toString(),
    async exchange(p) {
      const tokens = await client.validateAuthorizationCode(p.code, p.codeVerifier)
      const claims = decodeIdToken(tokens.idToken()) as IdClaims & {
        tid?: string
        xms_edov?: boolean | string | number
      }
      if (!claims.sub || !claims.tid) return null
      if (claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) return null
      if (!audienceOf(claims.aud).includes(clientId)) return null
      // `email` in a work or school account is whatever the tenant admin typed (the "nOAuth" trap): it counts only when
      // Microsoft says the tenant owns the domain (`xms_edov`, an optional claim to enable on the app registration).
      // A personal account's address is a mailbox Microsoft itself verified.
      const domainOwned =
        claims.xms_edov === true || claims.xms_edov === 1 || claims.xms_edov === '1'
      return {
        providerUserId: claims.sub,
        email: claims.email ?? null,
        emailVerified:
          claims.email !== undefined && (domainOwned || claims.tid === MICROSOFT_CONSUMER_TENANT),
        displayName: claims.name ?? null,
      }
    },
  }
}

function discordProvider(
  { clientId, clientSecret }: OAuthCredentials,
  redirectUri: string,
): Provider {
  const client = new Discord(clientId, clientSecret, redirectUri)
  return {
    name: 'Discord',
    authorizationUrl: (p) =>
      client.createAuthorizationURL(p.state, p.codeVerifier, ['identify', 'email']).toString(),
    async exchange(p) {
      const tokens = await client.validateAuthorizationCode(p.code, p.codeVerifier)
      const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { authorization: `Bearer ${tokens.accessToken()}` },
      })
      if (!res.ok) throw new Error(`Discord /users/@me failed: ${res.status}`)
      const user = (await res.json()) as {
        id?: string
        email?: string | null
        verified?: boolean
        global_name?: string | null
        username?: string
      }
      if (!user.id) return null
      return {
        providerUserId: user.id,
        email: user.email ?? null,
        emailVerified: user.verified === true,
        displayName: user.global_name ?? user.username ?? null,
      }
    },
  }
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
}

/** Any OpenID Connect provider, found through its discovery document (fetched once, retried after a failure). */
class OidcProvider implements Provider {
  private client: OAuth2Client
  private discovery: Promise<Discovery> | undefined

  constructor(
    private options: OidcProviderOptions,
    redirectUri: string,
  ) {
    this.client = new OAuth2Client(options.clientId, options.clientSecret, redirectUri)
  }

  get name() {
    return this.options.name
  }

  async authorizationUrl(p: Params): Promise<string> {
    const { authorization_endpoint } = await this.discover()
    return this.client
      .createAuthorizationURLWithPKCE(
        authorization_endpoint,
        p.state,
        CodeChallengeMethod.S256,
        p.codeVerifier,
        this.options.scopes ?? ['openid', 'email', 'profile'],
      )
      .toString()
  }

  async exchange(p: { code: string; codeVerifier: string }): Promise<OAuthProfile | null> {
    const discovery = await this.discover()
    const tokens = await this.client.validateAuthorizationCode(
      discovery.token_endpoint,
      p.code,
      p.codeVerifier,
    )
    const claims = decodeIdToken(tokens.idToken()) as IdClaims
    if (!claims.sub || claims.iss !== discovery.issuer) return null
    if (!audienceOf(claims.aud).includes(this.options.clientId)) return null
    return {
      providerUserId: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true,
      displayName: claims.name ?? claims.preferred_username ?? null,
    }
  }

  private discover(): Promise<Discovery> {
    this.discovery ??= this.fetchDiscovery().catch((err) => {
      this.discovery = undefined
      throw err
    })
    return this.discovery
  }

  private async fetchDiscovery(): Promise<Discovery> {
    const issuer = this.options.issuer.replace(/\/$/, '')
    const res = await fetch(`${issuer}/.well-known/openid-configuration`)
    if (!res.ok) throw new Error(`OIDC discovery for ${this.options.id} failed: ${res.status}`)
    const doc = (await res.json()) as Partial<Discovery>
    // The document must describe the issuer we asked about, or a hijacked URL could swap in other endpoints.
    if (!doc.issuer || doc.issuer.replace(/\/$/, '') !== issuer) {
      throw new Error(`OIDC discovery for ${this.options.id} names another issuer`)
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error(`OIDC discovery for ${this.options.id} is incomplete`)
    }
    return {
      issuer: doc.issuer,
      authorization_endpoint: doc.authorization_endpoint,
      token_endpoint: doc.token_endpoint,
    }
  }
}
