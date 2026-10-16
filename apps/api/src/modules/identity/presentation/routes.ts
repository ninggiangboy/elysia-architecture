import { Elysia, t } from 'elysia'
import { UnauthorizedError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { clientIp, userAgent } from '#/shared/http/client-info'
import { API_PREFIX } from '#/shared/http/constants'
import { errorResponse, validationError } from '#/shared/http/openapi'
import type { ConfirmEmailChange } from '../application/use-cases/confirm-email-change'
import type { Logout } from '../application/use-cases/logout'
import type { RefreshSession } from '../application/use-cases/refresh-session'
import type { RequestEmailChange } from '../application/use-cases/request-email-change'
import type { RequestMagicLink } from '../application/use-cases/request-magic-link'
import type {
  VerifyMagicLink,
  VerifyMagicLinkResult,
} from '../application/use-cases/verify-magic-link'

export interface IdentityRouteDeps {
  verifier: TokenVerifier
  jwks: () => unknown
  secureCookies: boolean
  useCases: {
    requestMagicLink: RequestMagicLink
    verifyMagicLink: VerifyMagicLink
    refreshSession: RefreshSession
    logout: Logout
    requestEmailChange: RequestEmailChange
    confirmEmailChange: ConfirmEmailChange
  }
}

const REFRESH_COOKIE = 'refresh_token'
const COOKIE_PATH = `${API_PREFIX}/auth`

const cookieSchema = t.Cookie({ [REFRESH_COOKIE]: t.Optional(t.String()) })
const tokenBody = t.Object({
  token: t.String({
    minLength: 1,
    maxLength: 200,
    description: 'Token received in the link sent by email',
  }),
})

const sessionBody = t.Object(
  {
    accessToken: t.String({ description: 'JWT, sent via `Authorization: Bearer`' }),
    expiresIn: t.Number({ description: 'Access token lifetime (seconds)' }),
    user: t.Object({ id: t.String(), email: t.String({ format: 'email' }) }),
  },
  { description: 'New session. The refresh token is set in the HttpOnly cookie `refresh_token`' },
)

const sentBody = t.Object({ status: t.Literal('sent') })

const sessionResponse = (result: VerifyMagicLinkResult) => ({
  accessToken: result.session.accessToken,
  expiresIn: result.session.accessTokenExpiresIn,
  user: result.user,
})

export const identityRoutes = (deps: IdentityRouteDeps) => {
  const { useCases: uc } = deps

  const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
    .use(authPlugin(deps.verifier))
    .post(
      '/magic-link',
      async ({ body, request, server, set }) => {
        await uc.requestMagicLink.execute({ email: body.email, ip: clientIp(request, server) })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        body: t.Object({
          email: t.String({ maxLength: 254, description: 'Email that receives the sign-in link' }),
        }),
        detail: {
          summary: 'Send magic link',
          description:
            'Sends an email containing a one-time sign-in link. The account is created automatically on first sign-in. ' +
            'Rate-limited per email and IP.',
        },
        response: {
          202: t.Object(sentBody.properties, {
            description: 'Request accepted, the email will be sent asynchronously',
          }),
          400: validationError('invalid_email'),
          429: errorResponse(429, 'magic_link_rate_limited'),
        },
      },
    )
    .post(
      '/magic-link/verify',
      async ({ body, request, server, cookie }) => {
        const result = await uc.verifyMagicLink.execute({
          token: body.token,
          meta: { ip: clientIp(request, server), userAgent: userAgent(request) },
        })
        setRefreshCookie(cookie, result, deps.secureCookies)
        return sessionResponse(result)
      },
      {
        body: tokenBody,
        cookie: cookieSchema,
        detail: {
          summary: 'Sign in with magic link',
          description:
            'Exchanges the token in the link for an access token and sets the refresh token cookie.',
        },
        response: {
          200: sessionBody,
          400: validationError('invalid_magic_link'),
        },
      },
    )
    .post(
      '/refresh',
      async ({ request, server, cookie }) => {
        const current = cookie[REFRESH_COOKIE]?.value
        if (!current) throw new UnauthorizedError('missing_refresh_token', 'No active session')
        try {
          const result = await uc.refreshSession.execute({
            refreshToken: current,
            meta: { ip: clientIp(request, server), userAgent: userAgent(request) },
          })
          setRefreshCookie(cookie, result, deps.secureCookies)
          return sessionResponse(result)
        } catch (err) {
          if (err instanceof UnauthorizedError) clearRefreshCookie(cookie, deps.secureCookies)
          throw err
        }
      },
      {
        cookie: cookieSchema,
        detail: {
          summary: 'Refresh session',
          description:
            'Uses the `refresh_token` cookie to issue a new access token and rotate the refresh token. ' +
            'Reusing an old refresh token (outside the grace window) revokes the whole session.',
        },
        response: {
          200: sessionBody,
          400: validationError(),
          401: errorResponse(401, 'missing_refresh_token', 'invalid_refresh_token'),
        },
      },
    )
    .post(
      '/logout',
      async ({ auth, cookie, set }) => {
        await uc.logout.execute({ sessionId: auth.sessionId })
        clearRefreshCookie(cookie, deps.secureCookies)
        set.status = 204
      },
      {
        auth: true,
        cookie: cookieSchema,
        detail: {
          summary: 'Sign out',
          description: 'Revokes the current session and clears the refresh token cookie.',
        },
        response: { 204: t.Void({ description: 'Signed out' }) },
      },
    )

  const accountRoutes = new Elysia({ prefix: '/account', tags: ['account'] })
    .use(authPlugin(deps.verifier))
    .post(
      '/email-change',
      async ({ auth, body, set }) => {
        await uc.requestEmailChange.execute({ userId: auth.userId, newEmail: body.newEmail })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        auth: true,
        body: t.Object({ newEmail: t.String({ maxLength: 254, description: 'New email' }) }),
        detail: {
          summary: 'Request email change',
          description:
            'Sends a confirmation link to the new email. The email changes only after confirming via the link.',
        },
        response: {
          202: t.Object(sentBody.properties, {
            description: 'Request accepted, the email will be sent asynchronously',
          }),
          400: validationError('invalid_email', 'email_unchanged'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'email_taken'),
        },
      },
    )
    // The token in the mail is a credential — no sign-in required (the user may open the link in another browser).
    .post(
      '/email-change/confirm',
      ({ body }) => uc.confirmEmailChange.execute({ token: body.token }),
      {
        body: tokenBody,
        detail: {
          summary: 'Confirm email change',
          description: 'No sign-in required: the token in the email is the credential.',
        },
        response: {
          200: t.Object({
            email: t.String({ format: 'email', description: "The account's new email" }),
          }),
          400: validationError('invalid_email_change_token'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'email_taken'),
        },
      },
    )

  return new Elysia({ name: 'identity-routes' })
    .use(authRoutes)
    .use(accountRoutes)
    .get('/.well-known/jwks.json', () => deps.jwks(), {
      detail: {
        tags: ['auth'],
        summary: 'JWKS',
        description:
          'Public key (JWK Set) so other services can verify access tokens without calling this API each time.',
      },
    })
}

type CookieJar = Record<
  string,
  { set(opts: Record<string, unknown>): unknown; remove(): unknown } | undefined
>

function setRefreshCookie(cookie: CookieJar, result: VerifyMagicLinkResult, secure: boolean) {
  cookie[REFRESH_COOKIE]?.set({
    value: result.session.refreshToken,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: COOKIE_PATH,
    expires: result.session.refreshTokenExpiresAt,
  })
}

function clearRefreshCookie(cookie: CookieJar, secure: boolean) {
  cookie[REFRESH_COOKIE]?.set({
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: COOKIE_PATH,
    maxAge: 0,
  })
}
