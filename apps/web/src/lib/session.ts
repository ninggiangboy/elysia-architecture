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

const ROTATED_RETRY_MS = 300

// Use raw fetch (not the api client) to avoid an interceptor loop.
const postRefresh = () =>
  fetch(`${apiOrigin()}/api/auth/refresh`, { method: 'POST', credentials: 'include' })

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.clone().json()) as { error?: { code?: string } }).error?.code
  } catch {
    return undefined
  }
}

/**
 * Exchanges the refresh cookie for a new access token. Single-flight: many requests hitting 401 together call refresh only ONCE
 * (the refresh token rotates, so parallel calls would break the session).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      let res = await postRefresh()
      // Another tab of this browser rotated the token a moment ago; the server kept the cookie its response set.
      // Give that response time to land, then try once more with the current cookie.
      if (res.status === 401 && (await errorCode(res)) === 'refresh_token_rotated') {
        await new Promise((resolve) => setTimeout(resolve, ROTATED_RETRY_MS))
        res = await postRefresh()
      }
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
