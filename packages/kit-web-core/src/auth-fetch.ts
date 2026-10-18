import type { AuthStore } from './auth-store'

export interface AuthFetchOptions<User> {
  store: AuthStore<User>
  /** Renews the access token (single-flight); true when it worked. */
  refresh: () => Promise<boolean>
  /** The language the app is showing: the server writes its answers (and, for a new account, its mail) in it. */
  locale: () => string
  /** Requests that must not trigger a refresh on 401 (the auth endpoints themselves). */
  isAuthEndpoint: (input: RequestInfo | URL) => boolean
  /** Called with a request that got no answer at all (the API may be down). */
  onNetworkFailure?: (err: unknown) => unknown
  /** Called with every response (maintenance and outage detection). */
  onResponse?: (res: Response) => unknown
  /** Dev only: wait before sending, so loading states are visible. */
  beforeSend?: (input: RequestInfo | URL, init?: RequestInit) => Promise<void>
}

/** fetch with a Bearer token and the app's language; on 401 it refreshes (single-flight) and retries exactly once. */
export function createAuthFetch<User>(options: AuthFetchOptions<User>): typeof fetch {
  const { store, refresh, locale, isAuthEndpoint, onNetworkFailure, onResponse, beforeSend } =
    options
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const send = () => {
      const headers = new Headers(init?.headers)
      const token = store.get().accessToken
      if (token) headers.set('authorization', `Bearer ${token}`)
      headers.set('accept-language', locale())
      return fetch(input, { ...init, headers, credentials: 'include' })
    }
    // A request that gets no answer at all may mean the API is down: have a look (without holding up the caller's error).
    const sendWatched = async () => {
      try {
        return await send()
      } catch (err) {
        void onNetworkFailure?.(err)
        throw err
      }
    }
    await beforeSend?.(input, init)
    let res = await sendWatched()
    if (res.status === 401 && !isAuthEndpoint(input) && store.get().accessToken) {
      if (await refresh()) res = await sendWatched()
    }
    await onResponse?.(res)
    return res
  }) as typeof fetch // bun-types adds `preconnect` to typeof fetch; cast to match
}
