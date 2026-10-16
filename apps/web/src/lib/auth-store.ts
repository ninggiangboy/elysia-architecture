import { useSyncExternalStore } from 'react'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthState {
  /** unknown = have not yet tried to restore the session from the refresh cookie. */
  status: 'unknown' | 'authenticated' | 'anonymous'
  /** The access token lives only in memory (not localStorage) to reduce XSS surface; the refresh token is in an httpOnly cookie. */
  accessToken: string | null
  user: AuthUser | null
}

let state: AuthState = { status: 'unknown', accessToken: null, user: null }
const listeners = new Set<() => void>()

export const authStore = {
  get: () => state,
  set(next: AuthState) {
    state = next
    for (const l of listeners) l()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useAuth = () => useSyncExternalStore(authStore.subscribe, authStore.get)
