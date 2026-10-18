import type { AuthStore } from './auth-store'

export interface SessionResponse<User> {
  accessToken: string
  user: User
}

export interface SessionOptions<User> {
  store: AuthStore<User>
  /** Where the refresh cookie is exchanged for a session (`POST`, cookie included). */
  refreshUrl: () => string
  /** Wait before retrying a refresh that lost a race with another tab. */
  rotatedRetryMs?: number
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.clone().json()) as { error?: { code?: string } }).error?.code
  } catch {
    return undefined
  }
}

/** The session of the signed-in user: what is in the store, and how it is restored and renewed. */
export function createSession<User>({
  store,
  refreshUrl,
  rotatedRetryMs = 300,
}: SessionOptions<User>) {
  function applySession(data: SessionResponse<User>) {
    store.set({ status: 'authenticated', accessToken: data.accessToken, user: data.user })
  }

  /** Swaps in a fresher access token for the same user and session (after confirming it is them). */
  function applyAccessToken(accessToken: string) {
    store.set({ status: 'authenticated', accessToken, user: store.get().user })
  }

  function clearSession() {
    store.set({ status: 'anonymous', accessToken: null, user: null })
  }

  let inflight: Promise<boolean> | null = null

  // Use raw fetch (not the api client) to avoid an interceptor loop.
  const postRefresh = () => fetch(refreshUrl(), { method: 'POST', credentials: 'include' })

  /**
   * Exchanges the refresh cookie for a new access token. Single-flight: many requests hitting 401 together call refresh only ONCE
   * (the refresh token rotates, so parallel calls would break the session).
   */
  function refreshSession(): Promise<boolean> {
    inflight ??= (async () => {
      try {
        let res = await postRefresh()
        // Another tab of this browser rotated the token a moment ago; the server kept the cookie its response set.
        // Give that response time to land, then try once more with the current cookie.
        if (res.status === 401 && (await errorCode(res)) === 'refresh_token_rotated') {
          await new Promise((resolve) => setTimeout(resolve, rotatedRetryMs))
          res = await postRefresh()
        }
        if (!res.ok) {
          clearSession()
          return false
        }
        applySession((await res.json()) as SessionResponse<User>)
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
  async function ensureSession(): Promise<boolean> {
    const { status } = store.get()
    if (status !== 'unknown') return status === 'authenticated'
    return refreshSession()
  }

  return { applySession, applyAccessToken, clearSession, refreshSession, ensureSession }
}

export type Session<User> = ReturnType<typeof createSession<User>>
