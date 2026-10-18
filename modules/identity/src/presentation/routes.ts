import { LOCALES } from '@app/shared-types/locales'
import { authPlugin, type TokenVerifier } from '@kit/auth'
import { UnauthorizedError } from '@kit/core'
import { API_PREFIX, clientIp, errorResponse, userAgent, validationError } from '@kit/http'
import { Elysia, t } from 'elysia'
import type { AuthOutcome, SessionResult } from '../application/auth-outcome'
import type { WebAuthnResponse } from '../application/ports'
import type { GetAuthOptions, GetSecuritySummary } from '../application/use-cases/auth-options'
import type { ChangeLocale } from '../application/use-cases/change-locale'
import type { ConfirmEmailChange } from '../application/use-cases/confirm-email-change'
import type {
  ListInvitations,
  RevokeInvitation,
  SendInvitation,
} from '../application/use-cases/invitations'
import type { Logout } from '../application/use-cases/logout'
import type { ListPasskeys, RemovePasskey } from '../application/use-cases/manage-passkeys'
import type {
  ListSessions,
  RevokeOtherSessions,
  RevokeSession,
} from '../application/use-cases/manage-sessions'
import type {
  BeginOAuth,
  CompleteOAuth,
  ListOAuthAccounts,
  ListOAuthProviders,
  UnlinkOAuthAccount,
} from '../application/use-cases/oauth'
import type { BeginPasskeyLogin, FinishPasskeyLogin } from '../application/use-cases/passkey-login'
import type {
  BeginPasskeyRegistration,
  FinishPasskeyRegistration,
} from '../application/use-cases/passkey-registration'
import type {
  LoginWithPassword,
  RemovePassword,
  RequestPasswordReset,
  ResetPassword,
  SetPassword,
} from '../application/use-cases/password'
import type { RefreshSession } from '../application/use-cases/refresh-session'
import type { RequestEmailChange } from '../application/use-cases/request-email-change'
import type { RequestMagicLink } from '../application/use-cases/request-magic-link'
import type {
  CompleteSignup,
  RegisterWithPassword,
  VerifySignup,
} from '../application/use-cases/signup'
import type {
  BeginStepUpPasskey,
  FinishStepUpPasskey,
  RequestStepUpCode,
  VerifyStepUpCode,
  VerifyStepUpPassword,
  VerifyStepUpTotp,
} from '../application/use-cases/step-up'
import type {
  BeginTwoFactorSetup,
  DisableTwoFactor,
  EnableTwoFactor,
  GetTwoFactorStatus,
  RegenerateRecoveryCodes,
  VerifyMfaLogin,
} from '../application/use-cases/two-factor'
import type { VerifyMagicLink } from '../application/use-cases/verify-magic-link'
import { localePlugin } from './locale.plugin'

export interface IdentityRouteDeps {
  verifier: TokenVerifier
  jwks: () => unknown
  secureCookies: boolean
  useCases: {
    getAuthOptions: GetAuthOptions
    getSecuritySummary: GetSecuritySummary
    requestMagicLink: RequestMagicLink
    verifyMagicLink: VerifyMagicLink
    loginWithPassword: LoginWithPassword
    registerWithPassword: RegisterWithPassword
    verifySignup: VerifySignup
    completeSignup: CompleteSignup
    requestPasswordReset: RequestPasswordReset
    resetPassword: ResetPassword
    setPassword: SetPassword
    removePassword: RemovePassword
    getTwoFactorStatus: GetTwoFactorStatus
    beginTwoFactorSetup: BeginTwoFactorSetup
    enableTwoFactor: EnableTwoFactor
    regenerateRecoveryCodes: RegenerateRecoveryCodes
    disableTwoFactor: DisableTwoFactor
    verifyMfaLogin: VerifyMfaLogin
    sendInvitation: SendInvitation
    listInvitations: ListInvitations
    revokeInvitation: RevokeInvitation
    verifyStepUpTotp: VerifyStepUpTotp
    verifyStepUpPassword: VerifyStepUpPassword
    refreshSession: RefreshSession
    logout: Logout
    listSessions: ListSessions
    revokeSession: RevokeSession
    revokeOtherSessions: RevokeOtherSessions
    requestEmailChange: RequestEmailChange
    changeLocale: ChangeLocale
    confirmEmailChange: ConfirmEmailChange
    listOAuthProviders: ListOAuthProviders
    beginOAuth: BeginOAuth
    completeOAuth: CompleteOAuth
    listOAuthAccounts: ListOAuthAccounts
    unlinkOAuthAccount: UnlinkOAuthAccount
    beginPasskeyLogin: BeginPasskeyLogin
    finishPasskeyLogin: FinishPasskeyLogin
    beginPasskeyRegistration: BeginPasskeyRegistration
    finishPasskeyRegistration: FinishPasskeyRegistration
    listPasskeys: ListPasskeys
    removePasskey: RemovePasskey
    requestStepUpCode: RequestStepUpCode
    verifyStepUpCode: VerifyStepUpCode
    beginStepUpPasskey: BeginStepUpPasskey
    finishStepUpPasskey: FinishStepUpPasskey
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
    status: t.Literal('authenticated'),
    accessToken: t.String({ description: 'JWT, sent via `Authorization: Bearer`' }),
    expiresIn: t.Number({ description: 'Access token lifetime (seconds)' }),
    user: t.Object({ id: t.String(), email: t.String({ format: 'email' }) }),
  },
  { description: 'New session. The refresh token is set in the HttpOnly cookie `refresh_token`' },
)

const mfaRequiredBody = t.Object(
  {
    status: t.Literal('mfa_required'),
    mfaToken: t.String({
      description: 'Send it with the authenticator code to `/auth/mfa/verify`',
    }),
    expiresIn: t.Number({ description: 'Seconds the token stays valid' }),
  },
  {
    description: 'The first factor was right; the account also needs a code from its authenticator',
  },
)

const signupRequiredBody = t.Object(
  {
    status: t.Literal('signup_required'),
    signupToken: t.String({ description: 'Send it to `/auth/signup/complete`' }),
    email: t.String({ format: 'email' }),
    suggestedName: t.Nullable(t.String({ description: 'Name the provider knows the person by' })),
    termsVersion: t.String({ description: 'The terms that must be accepted' }),
  },
  {
    description: 'The email is proven but no account exists: finish the sign-up form to create it',
  },
)

/** What the first step of a sign-in answers: signed in, a second factor to give, or a sign-up form to finish. */
const authBody = t.Union([sessionBody, mfaRequiredBody, signupRequiredBody])

const emailBody = t.String({ maxLength: 254, description: 'Account email' })
const passwordBody = t.String({ minLength: 1, maxLength: 256, description: 'Password' })
const newPasswordBody = t.String({ minLength: 1, maxLength: 1024, description: 'The new password' })
const codeBody = t.String({ minLength: 1, maxLength: 20, description: 'Code to type' })

const deviceSessionBody = t.Object({
  id: t.String({
    format: 'uuid',
    description: 'Session id (pass it to `DELETE /account/sessions/{id}`)',
  }),
  current: t.Boolean({ description: 'True for the session that made this request' }),
  userAgent: t.Nullable(t.String()),
  ip: t.Nullable(t.String()),
  startedAt: t.String({ format: 'date-time', description: 'When the device signed in' }),
  lastActiveAt: t.String({
    format: 'date-time',
    description: 'Last time its session was refreshed',
  }),
})

const sentBody = t.Object({ status: t.Literal('sent') })
const localeBody = t.UnionEnum([...LOCALES], { description: 'A language the product speaks' })

/** What the browser's WebAuthn API returned. Only `id` is read by us; the library validates the rest. */
const webauthnResponse = t.Object(
  { id: t.String({ minLength: 1, maxLength: 1024 }) },
  {
    additionalProperties: true,
    description: 'Result of `navigator.credentials.create/get`, as JSON',
  },
)
const challengeId = t.String({
  format: 'uuid',
  description: 'Id returned together with the options',
})
const webauthnOptionsBody = t.Object({
  challengeId,
  options: t.Unknown({ description: 'JSON for `navigator.credentials.create/get({ publicKey })`' }),
})
const elevatedBody = t.Object(
  {
    accessToken: t.String({
      description: 'Same session, with a fresh `auth_time` — use it from now on',
    }),
    expiresIn: t.Number({ description: 'Access token lifetime (seconds)' }),
  },
  { description: 'New access token that counts as a recent confirmation' },
)
const providerParam = t.Object({
  provider: t.String({ description: 'Sign-in provider id', examples: ['google', 'github'] }),
})
const urlBody = t.Object({ url: t.String({ description: 'Send the browser here to continue' }) })
const passkeyBody = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  deviceType: t.String({ description: '`singleDevice` or `multiDevice` (synced)' }),
  backedUp: t.Boolean(),
  createdAt: t.String({ format: 'date-time' }),
  lastUsedAt: t.Nullable(t.String({ format: 'date-time' })),
})
const oauthAccountBody = t.Object({
  provider: t.String(),
  email: t.Nullable(t.String({ description: 'Address the provider reported' })),
  linkedAt: t.String({ format: 'date-time' }),
})

const twoFactorBody = t.Object({
  available: t.Boolean({ description: 'The deployment offers authenticator apps' }),
  enabled: t.Boolean(),
  recoveryCodesRemaining: t.Number(),
})
const recoveryCodesBody = t.Object({
  recoveryCodes: t.Array(t.String(), { description: 'Shown once; each works once' }),
})
const invitationBody = t.Object({
  id: t.String({ format: 'uuid' }),
  email: t.String(),
  status: t.UnionEnum(['pending', 'accepted', 'expired', 'revoked']),
  createdAt: t.String({ format: 'date-time' }),
  expiresAt: t.String({ format: 'date-time' }),
})
const invitationJson = (i: {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  createdAt: Date
  expiresAt: Date
}) => ({
  ...i,
  createdAt: i.createdAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
})

const passkeyJson = (p: {
  id: string
  name: string
  deviceType: string
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}) => ({
  id: p.id,
  name: p.name,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
  createdAt: p.createdAt.toISOString(),
  lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
})

const sessionResponse = (result: SessionResult) => ({
  status: 'authenticated' as const,
  accessToken: result.session.accessToken,
  expiresIn: result.session.accessTokenExpiresIn,
  user: result.user,
})

export const identityRoutes = (deps: IdentityRouteDeps) => {
  const { useCases: uc } = deps

  /** Sets the refresh cookie only when the sign-in is complete. */
  const authResponse = (outcome: AuthOutcome, cookie: CookieJar) => {
    if (outcome.kind === 'session') {
      setRefreshCookie(cookie, outcome, deps.secureCookies)
      return sessionResponse(outcome)
    }
    if (outcome.kind === 'mfa_required') {
      return {
        status: 'mfa_required' as const,
        mfaToken: outcome.mfaToken,
        expiresIn: Math.max(0, Math.round((outcome.expiresAt.getTime() - Date.now()) / 1000)),
      }
    }
    return {
      status: 'signup_required' as const,
      signupToken: outcome.signupToken,
      email: outcome.email,
      suggestedName: outcome.suggestedName,
      termsVersion: outcome.termsVersion,
    }
  }
  const meta = (request: Request, server: Parameters<typeof clientIp>[1]) => ({
    ip: clientIp(request, server),
    userAgent: userAgent(request),
  })

  const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
    .use(authPlugin(deps.verifier))
    .use(localePlugin)
    .post(
      '/magic-link',
      async ({ body, request, server, set, locale }) => {
        await uc.requestMagicLink.execute({
          email: body.email,
          ip: clientIp(request, server),
          locale,
        })
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
    .get('/options', () => uc.getAuthOptions.execute(), {
      detail: {
        summary: 'Sign-in and sign-up options',
        description:
          'What this deployment offers, for the login and sign-up pages: sign-in methods, who may register (and under which terms), enabled providers, password length, whether two-factor exists.',
      },
      response: {
        200: t.Object({
          methods: t.Array(t.String(), { description: '`email`, `password`, `passkey`' }),
          registration: t.String({ description: '`open`, `invite` or `closed`' }),
          passwordMinLength: t.Number(),
          twoFactor: t.Boolean(),
          termsVersion: t.Nullable(t.String()),
          termsUrl: t.Nullable(t.String()),
          providers: t.Array(t.String()),
          providerNames: t.Record(t.String(), t.String()),
        }),
      },
    })
    .post(
      '/magic-link/verify',
      async ({ body, request, server, cookie, locale }) =>
        authResponse(
          await uc.verifyMagicLink.verifyToken({
            token: body.token,
            locale,
            meta: meta(request, server),
          }),
          cookie,
        ),
      {
        body: tokenBody,
        cookie: cookieSchema,
        detail: {
          summary: 'Sign in with magic link',
          description:
            'Exchanges the token in the link for an access token and sets the refresh token cookie. ' +
            'With two-factor on, answers `mfa_required` first; for a new address where terms must be accepted, `signup_required`.',
        },
        response: {
          200: authBody,
          400: validationError('invalid_magic_link'),
          403: errorResponse(
            403,
            'registration_closed',
            'registration_invite_only',
            'registration_domain_not_allowed',
          ),
        },
      },
    )
    .post(
      '/email-code/verify',
      async ({ body, request, server, cookie, locale }) =>
        authResponse(
          await uc.verifyMagicLink.verifyCode({
            email: body.email,
            code: body.code,
            locale,
            meta: meta(request, server),
          }),
          cookie,
        ),
      {
        body: t.Object({ email: emailBody, code: codeBody }),
        cookie: cookieSchema,
        detail: {
          summary: 'Sign in with the emailed code',
          description:
            'The 6 digits that come with the magic link, for when the mail is read on another device. A wrong code counts against 5 attempts.',
        },
        response: {
          200: authBody,
          400: validationError('invalid_email_code', 'invalid_email'),
          403: errorResponse(
            403,
            'registration_closed',
            'registration_invite_only',
            'registration_domain_not_allowed',
          ),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .post(
      '/login',
      async ({ body, request, server, cookie }) =>
        authResponse(
          await uc.loginWithPassword.execute({
            email: body.email,
            password: body.password,
            meta: meta(request, server),
          }),
          cookie,
        ),
      {
        body: t.Object({ email: emailBody, password: passwordBody }),
        cookie: cookieSchema,
        detail: {
          summary: 'Sign in with a password',
          description:
            'Wrong password, unknown address and an account without a password all answer the same 401. Repeated failures answer 429.',
        },
        response: {
          200: authBody,
          401: errorResponse(401, 'invalid_credentials'),
          404: errorResponse(404, 'sign_in_method_unavailable'),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .post(
      '/register',
      async ({ body, request, server, set, locale }) => {
        await uc.registerWithPassword.execute({
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          acceptTerms: body.acceptTerms,
          ip: clientIp(request, server),
          locale,
        })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        body: t.Object({
          email: emailBody,
          password: newPasswordBody,
          displayName: t.Optional(t.String({ maxLength: 100 })),
          acceptTerms: t.Optional(
            t.Boolean({ description: 'Required when the deployment has terms' }),
          ),
        }),
        detail: {
          summary: 'Sign up with a password',
          description:
            'Mails a verification link and code; the account exists only once the mailbox is proven (`/register/verify`). ' +
            'The answer is the same when the address already has an account (its owner is told) or may not register.',
        },
        response: {
          202: t.Object(sentBody.properties, { description: 'Verification mail on its way' }),
          400: validationError(
            'invalid_email',
            'password_too_short',
            'password_too_long',
            'terms_not_accepted',
          ),
          404: errorResponse(404, 'sign_in_method_unavailable'),
          429: errorResponse(429, 'signup_rate_limited'),
        },
      },
    )
    .post(
      '/register/verify',
      async ({ body, request, server, cookie }) => {
        const result = body.token
          ? await uc.verifySignup.verifyToken({ token: body.token, meta: meta(request, server) })
          : await uc.verifySignup.verifyCode({
              email: body.email ?? '',
              code: body.code ?? '',
              meta: meta(request, server),
            })
        setRefreshCookie(cookie, result, deps.secureCookies)
        return sessionResponse(result)
      },
      {
        body: t.Object({
          token: t.Optional(
            t.String({ minLength: 1, maxLength: 200, description: 'From the link' }),
          ),
          email: t.Optional(emailBody),
          code: t.Optional(codeBody),
        }),
        cookie: cookieSchema,
        detail: {
          summary: 'Verify a password sign-up',
          description:
            'Either the `token` from the link, or `email` and `code`. Creates the account and signs in.',
        },
        response: {
          200: sessionBody,
          400: validationError(
            'invalid_signup_verification',
            'invalid_email',
            'terms_not_accepted',
          ),
          403: errorResponse(403, 'registration_closed', 'registration_invite_only'),
          409: errorResponse(409, 'email_taken'),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .post(
      '/signup/complete',
      async ({ body, request, server, cookie }) => {
        const result = await uc.completeSignup.execute({
          signupToken: body.signupToken,
          displayName: body.displayName,
          acceptTerms: body.acceptTerms,
          meta: meta(request, server),
        })
        setRefreshCookie(cookie, result, deps.secureCookies)
        return sessionResponse(result)
      },
      {
        body: t.Object({
          signupToken: t.String({ minLength: 1, maxLength: 200 }),
          displayName: t.Optional(t.String({ maxLength: 100 })),
          acceptTerms: t.Optional(t.Boolean()),
        }),
        cookie: cookieSchema,
        detail: {
          summary: 'Finish a sign-up',
          description:
            'After a sign-in answered `signup_required`: choose a name, accept the terms, get the account and a session.',
        },
        response: {
          200: sessionBody,
          400: validationError('invalid_signup', 'terms_not_accepted'),
          403: errorResponse(403, 'registration_closed', 'registration_invite_only'),
          409: errorResponse(409, 'email_taken'),
        },
      },
    )
    .post(
      '/mfa/verify',
      async ({ body, request, server, cookie }) => {
        const result = await uc.verifyMfaLogin.execute({
          mfaToken: body.mfaToken,
          code: body.code,
          meta: meta(request, server),
        })
        setRefreshCookie(cookie, result, deps.secureCookies)
        return sessionResponse(result)
      },
      {
        body: t.Object({
          mfaToken: t.String({ minLength: 1, maxLength: 200 }),
          code: t.String({
            minLength: 1,
            maxLength: 30,
            description: 'The 6 digits from the authenticator app, or a recovery code',
          }),
        }),
        cookie: cookieSchema,
        detail: {
          summary: 'Second step of a sign-in',
          description:
            'Answers an `mfa_required` sign-in. Five wrong codes close the challenge; a recovery code works once.',
        },
        response: {
          200: sessionBody,
          401: errorResponse(401, 'invalid_mfa_code', 'mfa_challenge_expired'),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .post(
      '/password/forgot',
      async ({ body, request, server, set }) => {
        await uc.requestPasswordReset.execute({ email: body.email, ip: clientIp(request, server) })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        body: t.Object({ email: emailBody }),
        detail: {
          summary: 'Forgot password',
          description:
            'Mails a reset link to the account. The answer is the same whether or not the address has an account. Also how an account without a password sets one.',
        },
        response: {
          202: t.Object(sentBody.properties, {
            description: 'If the account exists, the mail is on its way',
          }),
          400: validationError('invalid_email'),
          404: errorResponse(404, 'sign_in_method_unavailable'),
          429: errorResponse(429, 'password_reset_rate_limited'),
        },
      },
    )
    .post(
      '/password/reset',
      async ({ body, set }) => {
        await uc.resetPassword.execute({ token: body.token, newPassword: body.newPassword })
        set.status = 204
      },
      {
        body: t.Object({ token: tokenBody.properties.token, newPassword: newPasswordBody }),
        detail: {
          summary: 'Reset password',
          description:
            'Sets the new password and signs the account out everywhere; sign in again afterwards.',
        },
        response: {
          204: t.Void({ description: 'Password changed' }),
          400: validationError('invalid_password_reset', 'password_too_short', 'password_too_long'),
          404: errorResponse(404, 'sign_in_method_unavailable'),
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
          // Not on `refresh_token_rotated`: another tab of this browser refreshed a moment ago and its response set the
          // cookie that now holds the session. Clearing it here could wipe that cookie if this response lands last.
          if (err instanceof UnauthorizedError && err.code !== 'refresh_token_rotated')
            clearRefreshCookie(cookie, deps.secureCookies)
          throw err
        }
      },
      {
        cookie: cookieSchema,
        detail: {
          summary: 'Refresh session',
          description:
            'Uses the `refresh_token` cookie to issue a new access token and rotate the refresh token. ' +
            'Reusing an old refresh token (outside the grace window) revokes the whole session. Inside the window ' +
            '(another tab refreshed first) the answer is 401 `refresh_token_rotated` and the cookie is left alone: retry.',
        },
        response: {
          200: sessionBody,
          400: validationError(),
          401: errorResponse(
            401,
            'missing_refresh_token',
            'invalid_refresh_token',
            'refresh_token_rotated',
          ),
        },
      },
    )
    .post(
      '/logout',
      async ({ auth, cookie, set }) => {
        await uc.logout.execute({ userId: auth.userId, sessionId: auth.sessionId })
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
    .get('/oauth/providers', () => uc.listOAuthProviders.execute(), {
      detail: {
        summary: 'List enabled OAuth providers',
        description:
          'Providers with credentials configured on the server, for the sign-in buttons.',
      },
      response: {
        200: t.Object({
          providers: t.Array(t.String()),
          names: t.Record(t.String(), t.String(), { description: 'Display name per provider id' }),
        }),
      },
    })
    .post(
      '/oauth/:provider/start',
      async ({ params }) => uc.beginOAuth.execute({ provider: params.provider, purpose: 'login' }),
      {
        params: providerParam,
        detail: {
          summary: 'Start OAuth sign-in',
          description:
            'Returns the provider URL to send the browser to. The provider sends it back to the web app at ' +
            '`/auth/oauth/callback?code&state`, which finishes with `POST /auth/oauth/callback`.',
        },
        response: {
          200: urlBody,
          400: validationError(),
          404: errorResponse(404, 'oauth_provider_unavailable'),
        },
      },
    )
    .post(
      '/oauth/callback',
      async ({ body, maybeAuth, request, server, cookie, locale }) => {
        const result = await uc.completeOAuth.execute({
          state: body.state,
          code: body.code,
          locale,
          authUserId: maybeAuth?.userId,
          meta: meta(request, server),
        })
        if (result.kind === 'link') {
          return { purpose: 'link' as const, provider: result.provider, email: result.email }
        }
        return { purpose: 'login' as const, ...authResponse(result.outcome, cookie) }
      },
      {
        authOptional: true,
        body: t.Object({
          code: t.String({ minLength: 1, maxLength: 2048 }),
          state: t.String({ minLength: 1, maxLength: 200 }),
        }),
        cookie: cookieSchema,
        detail: {
          summary: 'Finish OAuth flow',
          description:
            'Exchanges the `code` the provider returned. For a sign-in it creates the session (and the account on first use). ' +
            'For connecting a provider it must be called with the access token of the user who started it.',
        },
        response: {
          200: t.Union([
            t.Object({ purpose: t.Literal('login'), ...sessionBody.properties }),
            t.Object({ purpose: t.Literal('login'), ...mfaRequiredBody.properties }),
            t.Object({ purpose: t.Literal('login'), ...signupRequiredBody.properties }),
            t.Object({
              purpose: t.Literal('link'),
              provider: t.String(),
              email: t.Nullable(t.String()),
            }),
          ]),
          400: validationError(
            'invalid_oauth_state',
            'oauth_exchange_failed',
            'oauth_email_unverified',
          ),
          403: errorResponse(
            403,
            'oauth_state_mismatch',
            'registration_closed',
            'registration_invite_only',
            'registration_domain_not_allowed',
          ),
          409: errorResponse(409, 'oauth_account_taken', 'oauth_provider_already_linked'),
        },
      },
    )
    .post('/passkey/options', () => uc.beginPasskeyLogin.execute(), {
      detail: {
        summary: 'Start passkey sign-in',
        description:
          'Options for `navigator.credentials.get`. No email is needed: the browser offers the passkeys it holds for this site.',
      },
      response: { 200: webauthnOptionsBody },
    })
    .post(
      '/passkey/verify',
      async ({ body, request, server, cookie }) => {
        const result = await uc.finishPasskeyLogin.execute({
          challengeId: body.challengeId,
          response: body.response as WebAuthnResponse,
          meta: { ip: clientIp(request, server), userAgent: userAgent(request) },
        })
        setRefreshCookie(cookie, result, deps.secureCookies)
        return sessionResponse(result)
      },
      {
        body: t.Object({ challengeId, response: webauthnResponse }),
        cookie: cookieSchema,
        detail: {
          summary: 'Sign in with a passkey',
          description: 'Verifies the assertion and sets the refresh token cookie.',
        },
        response: {
          200: sessionBody,
          400: validationError('invalid_passkey_challenge'),
          401: errorResponse(
            401,
            'passkey_not_recognized',
            'passkey_rejected',
            'passkey_counter_regressed',
          ),
        },
      },
    )

  const accountRoutes = new Elysia({ prefix: '/account', tags: ['account'] })
    .use(authPlugin(deps.verifier))
    .post(
      '/email-change',
      async ({ auth, body, set }) => {
        await uc.requestEmailChange.execute({
          userId: auth.userId,
          newEmail: body.newEmail,
          authTime: auth.authTime,
        })
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
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'email_taken'),
        },
      },
    )
    .put(
      '/locale',
      async ({ auth, body, set }) => {
        await uc.changeLocale.execute({ userId: auth.userId, locale: body.locale })
        set.status = 204
      },
      {
        auth: true,
        body: t.Object({ locale: localeBody }),
        detail: {
          summary: 'Change language',
          description:
            'The language mail and notifications are written in. The web app calls it when the user picks a language.',
        },
        response: { 204: t.Void({ description: 'Saved' }), 400: validationError() },
      },
    )
    .get(
      '/sessions',
      async ({ auth }) => {
        const sessions = await uc.listSessions.execute({
          userId: auth.userId,
          currentSessionId: auth.sessionId,
        })
        return {
          sessions: sessions.map((s) => ({
            ...s,
            startedAt: s.startedAt.toISOString(),
            lastActiveAt: s.lastActiveAt.toISOString(),
          })),
        }
      },
      {
        auth: true,
        detail: {
          summary: 'List signed-in devices',
          description:
            'Sessions of the account that can still refresh, most recently active first.',
        },
        response: { 200: t.Object({ sessions: t.Array(deviceSessionBody) }) },
      },
    )
    .delete(
      '/sessions',
      ({ auth }) =>
        uc.revokeOtherSessions.execute({ userId: auth.userId, currentSessionId: auth.sessionId }),
      {
        auth: true,
        detail: {
          summary: 'Sign out all other devices',
          description:
            'Revokes every session except the current one. Access tokens already issued stay valid until they expire.',
        },
        response: { 200: t.Object({ revoked: t.Number({ description: 'Sessions ended' }) }) },
      },
    )
    .delete(
      '/sessions/:id',
      async ({ auth, params, cookie, set }) => {
        await uc.revokeSession.execute({ userId: auth.userId, sessionId: params.id })
        if (params.id === auth.sessionId) clearRefreshCookie(cookie, deps.secureCookies)
        set.status = 204
      },
      {
        auth: true,
        cookie: cookieSchema,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Sign out a device',
          description:
            'Remote logout: revokes the session so it can no longer refresh. Its current access token stays valid until it expires (≤ 15 min).',
        },
        response: {
          204: t.Void({ description: 'Session revoked' }),
          400: validationError(),
          404: errorResponse(404, 'session_not_found'),
        },
      },
    )
    .post(
      '/step-up/email-code',
      async ({ auth, set }) => {
        await uc.requestStepUpCode.execute({ userId: auth.userId })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        auth: true,
        detail: {
          summary: 'Email a confirmation code',
          description:
            'Sends a 6-digit code to the account email. Entering it (`/step-up/email-code/verify`) confirms a sensitive action.',
        },
        response: {
          202: t.Object(sentBody.properties, { description: 'The code will be mailed shortly' }),
          429: errorResponse(429, 'step_up_rate_limited'),
        },
      },
    )
    .post(
      '/step-up/email-code/verify',
      ({ auth, body }) =>
        uc.verifyStepUpCode.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          code: body.code,
        }),
      {
        auth: true,
        body: t.Object({
          code: t.String({ minLength: 1, maxLength: 20, description: 'The 6-digit code' }),
        }),
        detail: {
          summary: 'Confirm with an emailed code',
          description: 'A wrong code counts against 5 attempts; the code lasts 10 minutes.',
        },
        response: { 200: elevatedBody, 400: validationError('invalid_step_up_code') },
      },
    )
    .get(
      '/security',
      async ({ auth }) => {
        const summary = await uc.getSecuritySummary.execute({ userId: auth.userId })
        return {
          ...summary,
          passwordChangedAt: summary.passwordChangedAt?.toISOString() ?? null,
        }
      },
      {
        auth: true,
        detail: {
          summary: 'Security overview',
          description:
            'Which sign-in methods the account has and the deployment offers, and the two-factor state.',
        },
        response: {
          200: t.Object({
            email: t.String(),
            passwordAvailable: t.Boolean(),
            hasPassword: t.Boolean(),
            passwordChangedAt: t.Nullable(t.String({ format: 'date-time' })),
            emailSignIn: t.Boolean(),
            twoFactor: twoFactorBody,
            canInvite: t.Boolean(),
          }),
        },
      },
    )
    .put(
      '/password',
      async ({ auth, body }) =>
        uc.setPassword.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          newPassword: body.newPassword,
          authTime: auth.authTime,
        }),
      {
        auth: true,
        body: t.Object({ newPassword: newPasswordBody }),
        detail: {
          summary: 'Set or change the password',
          description:
            'Needs a recent confirmation. Every other device is signed out; this one stays.',
        },
        response: {
          200: t.Object({ change: t.UnionEnum(['set', 'changed']) }),
          400: validationError('password_too_short', 'password_too_long'),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'sign_in_method_unavailable'),
        },
      },
    )
    .delete(
      '/password',
      async ({ auth, set }) => {
        await uc.removePassword.execute({ userId: auth.userId, authTime: auth.authTime })
        set.status = 204
      },
      {
        auth: true,
        detail: {
          summary: 'Remove the password',
          description: 'Needs a recent confirmation and another way to sign in.',
        },
        response: {
          204: t.Void({ description: 'Password removed' }),
          400: validationError('no_password'),
          403: errorResponse(403, 'step_up_required'),
          409: errorResponse(409, 'last_sign_in_method'),
        },
      },
    )
    .get('/two-factor', ({ auth }) => uc.getTwoFactorStatus.execute({ userId: auth.userId }), {
      auth: true,
      detail: { summary: 'Two-factor status' },
      response: { 200: twoFactorBody },
    })
    .post(
      '/two-factor/setup',
      ({ auth }) =>
        uc.beginTwoFactorSetup.execute({ userId: auth.userId, authTime: auth.authTime }),
      {
        auth: true,
        detail: {
          summary: 'Start setting up an authenticator app',
          description:
            'Returns the secret and the `otpauth://` URI for the QR code. Nothing is on until `/two-factor/enable` gets a correct code. Needs a recent confirmation.',
        },
        response: {
          200: t.Object({ secret: t.String(), uri: t.String() }),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'two_factor_unavailable'),
          409: errorResponse(409, 'totp_already_enabled'),
        },
      },
    )
    .post(
      '/two-factor/enable',
      ({ auth, body }) => uc.enableTwoFactor.execute({ userId: auth.userId, code: body.code }),
      {
        auth: true,
        body: t.Object({ code: codeBody }),
        detail: {
          summary: 'Turn on two-factor',
          description:
            'A correct code from the authenticator app turns it on and returns the recovery codes — the only time they are shown.',
        },
        response: {
          200: recoveryCodesBody,
          400: validationError('invalid_totp_code', 'totp_not_started'),
          404: errorResponse(404, 'two_factor_unavailable'),
          409: errorResponse(409, 'totp_already_enabled'),
        },
      },
    )
    .post(
      '/two-factor/recovery-codes',
      ({ auth }) =>
        uc.regenerateRecoveryCodes.execute({ userId: auth.userId, authTime: auth.authTime }),
      {
        auth: true,
        detail: {
          summary: 'New recovery codes',
          description: 'Replaces the old codes. Needs a recent confirmation.',
        },
        response: {
          200: recoveryCodesBody,
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'two_factor_not_enabled', 'two_factor_unavailable'),
        },
      },
    )
    .delete(
      '/two-factor',
      async ({ auth, set }) => {
        await uc.disableTwoFactor.execute({ userId: auth.userId, authTime: auth.authTime })
        set.status = 204
      },
      {
        auth: true,
        detail: { summary: 'Turn off two-factor', description: 'Needs a recent confirmation.' },
        response: {
          204: t.Void({ description: 'Turned off' }),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'two_factor_not_enabled'),
        },
      },
    )
    .post(
      '/step-up/totp',
      ({ auth, body, request, server }) =>
        uc.verifyStepUpTotp.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          code: body.code,
          ip: clientIp(request, server),
        }),
      {
        auth: true,
        body: t.Object({ code: codeBody }),
        detail: {
          summary: 'Confirm with the authenticator app',
          description:
            'A code is accepted once. Wrong codes count against the sign-in guess limits.',
        },
        response: {
          200: elevatedBody,
          400: validationError('invalid_step_up_code'),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .post(
      '/step-up/password',
      ({ auth, body, request, server }) =>
        uc.verifyStepUpPassword.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          password: body.password,
          ip: clientIp(request, server),
        }),
      {
        auth: true,
        body: t.Object({ password: passwordBody }),
        detail: { summary: 'Confirm with the password' },
        response: {
          200: elevatedBody,
          400: validationError('invalid_step_up_password'),
          429: errorResponse(429, 'sign_in_rate_limited'),
        },
      },
    )
    .get(
      '/invitations',
      async ({ auth }) => ({
        invitations: (await uc.listInvitations.execute({ userId: auth.userId })).map(
          invitationJson,
        ),
      }),
      {
        auth: true,
        detail: { summary: 'Invitations you sent' },
        response: { 200: t.Object({ invitations: t.Array(invitationBody) }) },
      },
    )
    .post(
      '/invitations',
      async ({ auth, body, set }) => {
        const invitation = await uc.sendInvitation.execute({
          userId: auth.userId,
          email: body.email,
        })
        set.status = 201
        return invitationJson(invitation)
      },
      {
        auth: true,
        body: t.Object({ email: emailBody }),
        detail: {
          summary: 'Invite someone',
          description:
            'Only where registration is by invitation: lets the address create an account and mails them.',
        },
        response: {
          201: invitationBody,
          400: validationError('invalid_email'),
          404: errorResponse(404, 'invitations_unavailable'),
          409: errorResponse(409, 'already_a_member', 'invitation_exists'),
          429: errorResponse(429, 'invitation_rate_limited'),
        },
      },
    )
    .delete(
      '/invitations/:id',
      async ({ auth, params, set }) => {
        await uc.revokeInvitation.execute({ userId: auth.userId, invitationId: params.id })
        set.status = 204
      },
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { summary: 'Withdraw an invitation' },
        response: {
          204: t.Void({ description: 'Withdrawn' }),
          400: validationError(),
          404: errorResponse(404, 'invitation_not_found'),
        },
      },
    )
    .post(
      '/step-up/passkey/options',
      ({ auth }) => uc.beginStepUpPasskey.execute({ userId: auth.userId }),
      {
        auth: true,
        detail: {
          summary: 'Start confirming with a passkey',
          description:
            'Options for `navigator.credentials.get`, limited to the account’s own passkeys.',
        },
        response: { 200: webauthnOptionsBody, 400: validationError('no_passkeys') },
      },
    )
    .post(
      '/step-up/passkey/verify',
      ({ auth, body }) =>
        uc.finishStepUpPasskey.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          challengeId: body.challengeId,
          response: body.response as WebAuthnResponse,
        }),
      {
        auth: true,
        body: t.Object({ challengeId, response: webauthnResponse }),
        detail: { summary: 'Confirm with a passkey' },
        response: {
          200: elevatedBody,
          400: validationError('invalid_passkey_challenge'),
          401: errorResponse(401, 'passkey_not_recognized', 'passkey_rejected'),
        },
      },
    )
    .get(
      '/passkeys',
      async ({ auth }) => {
        const passkeys = await uc.listPasskeys.execute({ userId: auth.userId })
        return { passkeys: passkeys.map(passkeyJson) }
      },
      {
        auth: true,
        detail: { summary: 'List passkeys' },
        response: { 200: t.Object({ passkeys: t.Array(passkeyBody) }) },
      },
    )
    .post(
      '/passkeys/options',
      ({ auth }) =>
        uc.beginPasskeyRegistration.execute({ userId: auth.userId, authTime: auth.authTime }),
      {
        auth: true,
        detail: {
          summary: 'Start adding a passkey',
          description: 'Options for `navigator.credentials.create`. Needs a recent confirmation.',
        },
        response: {
          200: webauthnOptionsBody,
          403: errorResponse(403, 'step_up_required'),
          409: errorResponse(409, 'passkey_limit_reached'),
        },
      },
    )
    .post(
      '/passkeys',
      async ({ auth, body, set }) => {
        const passkey = await uc.finishPasskeyRegistration.execute({
          userId: auth.userId,
          authTime: auth.authTime,
          challengeId: body.challengeId,
          response: body.response as WebAuthnResponse,
          name: body.name,
        })
        set.status = 201
        return passkeyJson(passkey)
      },
      {
        auth: true,
        body: t.Object({
          challengeId,
          response: webauthnResponse,
          name: t.Optional(t.String({ maxLength: 60, description: 'A label to recognise it by' })),
        }),
        detail: {
          summary: 'Add a passkey',
          description: 'Verifies the attestation and stores the passkey.',
        },
        response: {
          201: passkeyBody,
          400: validationError('invalid_passkey_challenge', 'passkey_verification_failed'),
          403: errorResponse(403, 'step_up_required'),
          409: errorResponse(409, 'passkey_exists'),
        },
      },
    )
    .delete(
      '/passkeys/:id',
      async ({ auth, params, set }) => {
        await uc.removePasskey.execute({
          userId: auth.userId,
          passkeyId: params.id,
          authTime: auth.authTime,
        })
        set.status = 204
      },
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { summary: 'Remove a passkey', description: 'Needs a recent confirmation.' },
        response: {
          204: t.Void({ description: 'Passkey removed' }),
          400: validationError(),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'passkey_not_found'),
        },
      },
    )
    .get(
      '/oauth',
      async ({ auth }) => {
        const accounts = await uc.listOAuthAccounts.execute({ userId: auth.userId })
        return {
          accounts: accounts.map((a) => ({ ...a, linkedAt: a.linkedAt.toISOString() })),
        }
      },
      {
        auth: true,
        detail: { summary: 'List connected Google/GitHub accounts' },
        response: { 200: t.Object({ accounts: t.Array(oauthAccountBody) }) },
      },
    )
    .post(
      '/oauth/:provider/link',
      ({ auth, params }) =>
        uc.beginOAuth.execute({
          provider: params.provider,
          purpose: 'link',
          userId: auth.userId,
          authTime: auth.authTime,
        }),
      {
        auth: true,
        params: providerParam,
        detail: {
          summary: 'Connect a provider',
          description:
            'Returns the provider URL to send the browser to; finish with `POST /auth/oauth/callback` while signed in. Needs a recent confirmation.',
        },
        response: {
          200: urlBody,
          400: validationError(),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'oauth_provider_unavailable'),
        },
      },
    )
    .delete(
      '/oauth/:provider',
      async ({ auth, params, set }) => {
        await uc.unlinkOAuthAccount.execute({
          userId: auth.userId,
          provider: params.provider,
          authTime: auth.authTime,
        })
        set.status = 204
      },
      {
        auth: true,
        params: providerParam,
        detail: {
          summary: 'Disconnect a provider',
          description: 'Email sign-in always remains. Needs a recent confirmation.',
        },
        response: {
          204: t.Void({ description: 'Disconnected' }),
          403: errorResponse(403, 'step_up_required'),
          404: errorResponse(404, 'oauth_account_not_found'),
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

function setRefreshCookie(cookie: CookieJar, result: SessionResult, secure: boolean) {
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
