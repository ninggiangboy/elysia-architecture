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
    description: 'Token nhận được trong link gửi qua email',
  }),
})

const sessionBody = t.Object(
  {
    accessToken: t.String({ description: 'JWT, gửi qua `Authorization: Bearer`' }),
    expiresIn: t.Number({ description: 'Thời gian sống của access token (giây)' }),
    user: t.Object({ id: t.String(), email: t.String({ format: 'email' }) }),
  },
  { description: 'Phiên mới. Refresh token được set trong cookie HttpOnly `refresh_token`' },
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
          email: t.String({ maxLength: 254, description: 'Email nhận link đăng nhập' }),
        }),
        detail: {
          summary: 'Gửi magic link',
          description:
            'Gửi email chứa link đăng nhập một lần. Tài khoản được tạo tự động ở lần đăng nhập đầu tiên. ' +
            'Giới hạn theo email và IP.',
        },
        response: {
          202: t.Object(sentBody.properties, {
            description: 'Đã nhận yêu cầu, email sẽ được gửi bất đồng bộ',
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
          summary: 'Đăng nhập bằng magic link',
          description: 'Đổi token trong link lấy access token và set cookie refresh token.',
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
          summary: 'Làm mới phiên',
          description:
            'Dùng cookie `refresh_token` để cấp access token mới và xoay refresh token. ' +
            'Dùng lại refresh token cũ (ngoài khoảng ân hạn) sẽ thu hồi cả phiên.',
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
          summary: 'Đăng xuất',
          description: 'Thu hồi phiên hiện tại và xoá cookie refresh token.',
        },
        response: { 204: t.Void({ description: 'Đã đăng xuất' }) },
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
        body: t.Object({ newEmail: t.String({ maxLength: 254, description: 'Email mới' }) }),
        detail: {
          summary: 'Yêu cầu đổi email',
          description: 'Gửi link xác nhận tới email mới. Email chỉ đổi sau khi xác nhận qua link.',
        },
        response: {
          202: t.Object(sentBody.properties, {
            description: 'Đã nhận yêu cầu, email sẽ được gửi bất đồng bộ',
          }),
          400: validationError('invalid_email', 'email_unchanged'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'email_taken'),
        },
      },
    )
    // Token trong mail là credential — không cần đăng nhập (người dùng có thể mở link ở trình duyệt khác).
    .post(
      '/email-change/confirm',
      ({ body }) => uc.confirmEmailChange.execute({ token: body.token }),
      {
        body: tokenBody,
        detail: {
          summary: 'Xác nhận đổi email',
          description: 'Không cần đăng nhập: token trong email là credential.',
        },
        response: {
          200: t.Object({
            email: t.String({ format: 'email', description: 'Email mới của tài khoản' }),
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
          'Public key (JWK Set) để service khác verify access token mà không cần gọi API này mỗi lần.',
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
