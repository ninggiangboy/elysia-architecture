import { afterEach, describe, expect, test } from 'bun:test'
import { createAuthStore } from './auth-store'
import { createSession } from './session'

interface User {
  id: string
}
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const setup = () => {
  const store = createAuthStore<User>()
  const session = createSession<User>({
    store,
    refreshUrl: () => 'http://api.test/api/auth/refresh',
    rotatedRetryMs: 1,
  })
  return { store, session }
}
const ok = () => Response.json({ accessToken: 'fresh', user: { id: 'u1' } })
const rotated = () => Response.json({ error: { code: 'refresh_token_rotated' } }, { status: 401 })
const unauthorized = () => Response.json({ error: { code: 'unauthorized' } }, { status: 401 })

function answers(...list: (() => Response)[]) {
  const calls = { count: 0 }
  globalThis.fetch = (async () =>
    list[Math.min(calls.count++, list.length - 1)]?.()) as unknown as typeof fetch
  return calls
}

describe('createSession', () => {
  test('restores the session from the refresh cookie', async () => {
    const { store, session } = setup()
    answers(ok)
    expect(await session.ensureSession()).toBe(true)
    expect(store.get()).toEqual({
      status: 'authenticated',
      accessToken: 'fresh',
      user: { id: 'u1' },
    })
  })

  test('many callers refresh once (the token rotates, parallel refreshes would break the session)', async () => {
    const { session } = setup()
    const calls = answers(ok)
    const results = await Promise.all([
      session.refreshSession(),
      session.refreshSession(),
      session.refreshSession(),
    ])
    expect(results).toEqual([true, true, true])
    expect(calls.count).toBe(1)
  })

  test('a refresh that lost a race with another tab is tried once more', async () => {
    const { store, session } = setup()
    const calls = answers(rotated, ok)
    expect(await session.refreshSession()).toBe(true)
    expect(calls.count).toBe(2)
    expect(store.get().status).toBe('authenticated')
  })

  test('a refused refresh signs the user out', async () => {
    const { store, session } = setup()
    answers(unauthorized)
    expect(await session.refreshSession()).toBe(false)
    expect(store.get()).toEqual({ status: 'anonymous', accessToken: null, user: null })
  })

  test('a network failure signs the user out too, and a later refresh can try again', async () => {
    const { store, session } = setup()
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await session.refreshSession()).toBe(false)
    expect(store.get().status).toBe('anonymous')
    answers(ok)
    expect(await session.refreshSession()).toBe(true)
  })

  test('ensureSession does not ask again once the state is known', async () => {
    const { store, session } = setup()
    store.set({ status: 'anonymous', accessToken: null, user: null })
    const calls = answers(ok)
    expect(await session.ensureSession()).toBe(false)
    expect(calls.count).toBe(0)
  })

  test('a fresher access token keeps the user', () => {
    const { store, session } = setup()
    session.applySession({ accessToken: 'a', user: { id: 'u1' } })
    session.applyAccessToken('b')
    expect(store.get()).toEqual({ status: 'authenticated', accessToken: 'b', user: { id: 'u1' } })
  })
})
