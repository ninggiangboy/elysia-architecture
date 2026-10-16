import { queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'
import { forgetPush } from '@/lib/push'
import { queryClient } from '@/lib/query-client'
import { applySession, clearSession } from '@/lib/session'
import { getPasskey } from '@/lib/webauthn'

export const requestMagicLink = async (email: string) =>
  unwrap(await http.api.auth['magic-link'].post({ email }))

export async function verifyMagicLink(token: string) {
  const data = unwrap(await http.api.auth['magic-link'].verify.post({ token }))
  applySession(data)
  return data
}

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

/** Providers the server has credentials for (Google, GitHub…). */
export const oauthProvidersQuery = queryOptions({
  queryKey: ['auth', 'oauth-providers'],
  queryFn: async () => unwrap(await http.api.auth.oauth.providers.get()).providers,
  staleTime: Number.POSITIVE_INFINITY,
})

/** Where to send the browser to sign in with a provider. */
export const startOAuthLogin = async (provider: string) =>
  unwrap(await http.api.auth.oauth({ provider }).start.post()).url

/** The provider sent the browser back with `code` and `state`. A sign-in also starts the session. */
export async function completeOAuth(code: string, state: string) {
  const result = unwrap(await http.api.auth.oauth.callback.post({ code, state }))
  if (result.purpose === 'login') applySession(result)
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
