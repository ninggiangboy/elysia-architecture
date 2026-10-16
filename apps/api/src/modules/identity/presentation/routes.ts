import { Elysia, t } from 'elysia'
import { UnauthorizedError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { clientIp, userAgent } from '#/shared/http/client-info'
import { API_PREFIX } from '#/shared/http/constants'
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
const tokenBody = t.Object({ token: t.String({ minLength: 1, maxLength: 200 }) })

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
      { body: t.Object({ email: t.String({ maxLength: 254 }) }) },
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
      { body: tokenBody, cookie: cookieSchema },
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
      { cookie: cookieSchema },
    )
    .post(
      '/logout',
      async ({ auth, cookie, set }) => {
        await uc.logout.execute({ sessionId: auth.sessionId })
        clearRefreshCookie(cookie, deps.secureCookies)
        set.status = 204
      },
      { auth: true, cookie: cookieSchema },
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
      { auth: true, body: t.Object({ newEmail: t.String({ maxLength: 254 }) }) },
    )
    // Token trong mail là credential — không cần đăng nhập (người dùng có thể mở link ở trình duyệt khác).
    .post(
      '/email-change/confirm',
      ({ body }) => uc.confirmEmailChange.execute({ token: body.token }),
      {
        body: tokenBody,
      },
    )

  return new Elysia({ name: 'identity-routes' })
    .use(authRoutes)
    .use(accountRoutes)
    .get('/.well-known/jwks.json', () => deps.jwks(), { detail: { tags: ['auth'] } })
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
