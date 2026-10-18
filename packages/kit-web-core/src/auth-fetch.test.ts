import { afterEach, describe, expect, test } from 'bun:test'
import { createAuthFetch } from './auth-fetch'
import { createAuthStore } from './auth-store'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function setup(refreshWorks = true) {
  const store = createAuthStore<{ id: string }>()
  store.set({ status: 'authenticated', accessToken: 'old', user: { id: 'u1' } })
  const seen: { url: string; headers: Headers }[] = []
  let refreshes = 0
  const responses = {
    protected: [new Response('', { status: 401 }), new Response('ok')],
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) })
    return String(input).includes('/api/auth/')
      ? new Response('', { status: 401 })
      : responses.protected.shift()
  }) as unknown as typeof fetch
  const authFetch = createAuthFetch({
    store,
    locale: () => 'vi',
    isAuthEndpoint: (input) => String(input).includes('/api/auth/'),
    refresh: async () => {
      refreshes++
      if (refreshWorks)
        store.set({ status: 'authenticated', accessToken: 'new', user: { id: 'u1' } })
      return refreshWorks
    },
  })
  return { authFetch, seen, refreshes: () => refreshes }
}

describe('createAuthFetch', () => {
  test('sends the token and the language', async () => {
    const { authFetch, seen } = setup()
    await authFetch('http://api.test/api/me')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer old')
    expect(seen[0]?.headers.get('accept-language')).toBe('vi')
  })

  test('on 401 it refreshes and retries exactly once, with the new token', async () => {
    const { authFetch, seen, refreshes } = setup()
    const res = await authFetch('http://api.test/api/me')
    expect(await res.text()).toBe('ok')
    expect(refreshes()).toBe(1)
    expect(seen.map((s) => s.headers.get('authorization'))).toEqual(['Bearer old', 'Bearer new'])
  })

  test('a refresh that fails leaves the 401 to the caller', async () => {
    const { authFetch, seen } = setup(false)
    const res = await authFetch('http://api.test/api/me')
    expect(res.status).toBe(401)
    expect(seen).toHaveLength(1)
  })

  test('the auth endpoints themselves never trigger a refresh', async () => {
    const { authFetch, refreshes } = setup()
    const res = await authFetch('http://api.test/api/auth/magic-link')
    expect(res.status).toBe(401)
    expect(refreshes()).toBe(0)
  })

  test('tells the network watcher when a request gets no answer at all', async () => {
    const store = createAuthStore<{ id: string }>()
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const failures: unknown[] = []
    const authFetch = createAuthFetch({
      store,
      locale: () => 'en',
      isAuthEndpoint: () => false,
      refresh: async () => false,
      onNetworkFailure: (err) => failures.push(err),
    })
    await expect(authFetch('http://api.test/x')).rejects.toThrow('Failed to fetch')
    expect(failures).toHaveLength(1)
  })
})
