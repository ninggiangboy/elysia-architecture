import { queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'
import { forgetPush } from '@/lib/push'
import { queryClient } from '@/lib/query-client'
import { applySession, clearSession } from '@/lib/session'
import { getPasskey } from '@/lib/webauthn'

/** What this deployment offers: sign-in methods, who may register, providers, two-factor. */
export const authOptionsQuery = queryOptions({
  queryKey: ['auth', 'options'],
  queryFn: async () => unwrap(await http.api.auth.options.get()),
  staleTime: Number.POSITIVE_INFINITY,
})

/** What a first step of signing in answers: done, a second factor to give, or a sign-up form to finish. */
type Outcome =
  | {
      status: 'authenticated'
      accessToken: string
      expiresIn: number
      user: { id: string; email: string }
    }
  | { status: 'mfa_required'; mfaToken: string; expiresIn: number }
  | {
      status: 'signup_required'
      signupToken: string
      email: string
      suggestedName: string | null
      termsVersion: string
    }

/** Starts the session when the sign-in is complete; otherwise hands back what is still to do. */
function settle<T extends Outcome>(data: T): T {
  if (data.status === 'authenticated') applySession(data)
  return data
}

export const requestMagicLink = async (email: string) =>
  unwrap(await http.api.auth['magic-link'].post({ email }))

export async function verifyMagicLink(token: string) {
  return settle(unwrap(await http.api.auth['magic-link'].verify.post({ token })))
}

/** The 6 digits that come in the same mail as the link. */
export async function verifyEmailCode(email: string, code: string) {
  return settle(unwrap(await http.api.auth['email-code'].verify.post({ email, code })))
}

export async function loginWithPassword(email: string, password: string) {
  return settle(unwrap(await http.api.auth.login.post({ email, password })))
}

/** Second step of a sign-in: the authenticator code, or a recovery code. */
export async function verifyMfa(mfaToken: string, code: string) {
  const data = unwrap(await http.api.auth.mfa.verify.post({ mfaToken, code }))
  applySession(data)
  return data
}

export const registerWithPassword = async (params: {
  email: string
  password: string
  displayName?: string
  acceptTerms?: boolean
}) => unwrap(await http.api.auth.register.post(params))

export async function verifySignupToken(token: string) {
  const data = unwrap(await http.api.auth.register.verify.post({ token }))
  applySession(data)
  return data
}

export async function verifySignupCode(email: string, code: string) {
  const data = unwrap(await http.api.auth.register.verify.post({ email, code }))
  applySession(data)
  return data
}

export async function completeSignup(params: {
  signupToken: string
  displayName?: string
  acceptTerms?: boolean
}) {
  const data = unwrap(await http.api.auth.signup.complete.post(params))
  applySession(data)
  return data
}

export const requestPasswordReset = async (email: string) =>
  unwrap(await http.api.auth.password.forgot.post({ email }))

export const resetPassword = async (token: string, newPassword: string) =>
  unwrap(await http.api.auth.password.reset.post({ token, newPassword }))

/** Sign-in without typing anything: the browser offers the passkeys it holds for this site. */
export async function loginWithPasskey() {
  const begin = unwrap(await http.api.auth.passkey.options.post())
  const response = await getPasskey(begin.options)
  const data = unwrap(
    await http.api.auth.passkey.verify.post({ challengeId: begin.challengeId, response }),
  )
  applySession(data)
  return data
}

/** Providers the server has credentials for (Google, GitHub, Microsoft, OIDC…). */
export const oauthProvidersQuery = queryOptions({
  queryKey: ['auth', 'oauth-providers'],
  queryFn: async () => unwrap(await http.api.auth.oauth.providers.get()),
  staleTime: Number.POSITIVE_INFINITY,
})

/** Where to send the browser to sign in with a provider. */
export const startOAuthLogin = async (provider: string) =>
  unwrap(await http.api.auth.oauth({ provider }).start.post()).url

/** The provider sent the browser back with `code` and `state`. A finished sign-in also starts the session. */
export async function completeOAuth(code: string, state: string) {
  const result = unwrap(await http.api.auth.oauth.callback.post({ code, state }))
  if (result.purpose === 'login') settle(result)
  return result
}

export async function logout() {
  try {
    await http.api.auth.logout.post()
  } finally {
    void forgetPush()
    clearSession()
    queryClient.clear()
  }
}
