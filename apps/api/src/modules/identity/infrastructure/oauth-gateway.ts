import { decodeIdToken, GitHub, Google, OAuth2RequestError } from 'arctic'
import type { OAuthGateway, OAuthProfile } from '../application/ports'
import type { OAuthProviderId } from '../domain/oauth-account'

interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

export interface OAuthGatewayOptions {
  /** Where providers send the browser back — a page of the web app, which forwards `code` and `state` to the API. */
  redirectUri: string
  google?: OAuthCredentials
  github?: OAuthCredentials
}

const GITHUB_API = 'https://api.github.com'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** Authorization-code flow against Google (OIDC + PKCE) and GitHub, built on `arctic`. */
export class ArcticOAuthGateway implements OAuthGateway {
  private google?: { client: Google; clientId: string }
  private github?: GitHub

  constructor(options: OAuthGatewayOptions) {
    if (options.google) {
      const { clientId, clientSecret } = options.google
      this.google = { client: new Google(clientId, clientSecret, options.redirectUri), clientId }
    }
    if (options.github) {
      const { clientId, clientSecret } = options.github
      this.github = new GitHub(clientId, clientSecret, options.redirectUri)
    }
  }

  enabledProviders(): OAuthProviderId[] {
    const enabled: OAuthProviderId[] = []
    if (this.google) enabled.push('google')
    if (this.github) enabled.push('github')
    return enabled
  }

  authorizationUrl(
    provider: OAuthProviderId,
    params: { state: string; codeVerifier: string },
  ): string {
    if (provider === 'google' && this.google) {
      return this.google.client
        .createAuthorizationURL(params.state, params.codeVerifier, ['openid', 'email'])
        .toString()
    }
    if (provider === 'github' && this.github) {
      return this.github.createAuthorizationURL(params.state, ['user:email']).toString()
    }
    throw new Error(`OAuth provider ${provider} is not configured`)
  }

  async exchange(
    provider: OAuthProviderId,
    params: { code: string; codeVerifier: string },
  ): Promise<OAuthProfile | null> {
    try {
      if (provider === 'google' && this.google) return await this.googleProfile(this.google, params)
      if (provider === 'github' && this.github) return await this.githubProfile(this.github, params)
    } catch (err) {
      // The provider said no (expired / reused code, wrong verifier). Anything else is a real failure.
      if (err instanceof OAuth2RequestError) return null
      throw err
    }
    throw new Error(`OAuth provider ${provider} is not configured`)
  }

  private async googleProfile(
    google: { client: Google; clientId: string },
    params: { code: string; codeVerifier: string },
  ): Promise<OAuthProfile | null> {
    const tokens = await google.client.validateAuthorizationCode(params.code, params.codeVerifier)
    // The id_token came straight from Google's token endpoint over TLS, so it is not re-verified by signature
    // (OIDC Core §3.1.3.7), but it must still be meant for us.
    const claims = decodeIdToken(tokens.idToken()) as {
      iss?: string
      aud?: string | string[]
      sub?: string
      email?: string
      email_verified?: boolean
    }
    const audience = [claims.aud ?? []].flat()
    if (!claims.sub || !claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) return null
    if (!audience.includes(google.clientId)) return null
    return {
      providerUserId: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true,
    }
  }

  private async githubProfile(
    github: GitHub,
    params: { code: string },
  ): Promise<OAuthProfile | null> {
    const tokens = await github.validateAuthorizationCode(params.code)
    const headers = {
      authorization: `Bearer ${tokens.accessToken()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'elysia-architecture',
    }
    const userRes = await fetch(`${GITHUB_API}/user`, { headers })
    if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`)
    const user = (await userRes.json()) as { id?: number }
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
    }
  }
}
