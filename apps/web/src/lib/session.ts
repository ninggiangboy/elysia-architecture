import { type AuthUser, authStore } from './auth-store'
import { apiOrigin } from './config'

interface SessionResponse {
  accessToken: string
  user: AuthUser
}

export function applySession(data: SessionResponse) {
  authStore.set({ status: 'authenticated', accessToken: data.accessToken, user: data.user })
}

/** Swaps in a fresher access token for the same user and session (after confirming it is them). */
export function applyAccessToken(accessToken: string) {
  const { user } = authStore.get()
  authStore.set({ status: 'authenticated', accessToken, user })
}

export function clearSession() {
  authStore.set({ status: 'anonymous', accessToken: null, user: null })
}

let inflight: Promise<boolean> | null = null

/**
 * Exchanges the refresh cookie for a new access token. Single-flight: many requests hitting 401 together call refresh only ONCE
 * (the refresh token rotates, so parallel calls would break the session).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      // Use raw fetch (not the api client) to avoid an interceptor loop.
      const res = await fetch(`${apiOrigin()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        clearSession()
        return false
      }
      applySession((await res.json()) as SessionResponse)
      return true
    } catch {
      clearSession()
      return false
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Call before entering a route that needs sign-in: restores the session from the cookie if the state is not yet known. */
export async function ensureSession(): Promise<boolean> {
  const { status } = authStore.get()
  if (status !== 'unknown') return status === 'authenticated'
  return refreshSession()
}
