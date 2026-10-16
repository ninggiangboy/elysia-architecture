import { useSyncExternalStore } from 'react'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthState {
  /** unknown = chưa thử khôi phục phiên từ cookie refresh. */
  status: 'unknown' | 'authenticated' | 'anonymous'
  /** Access token chỉ nằm trong bộ nhớ (không localStorage) để giảm bề mặt XSS; refresh token ở cookie httpOnly. */
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
