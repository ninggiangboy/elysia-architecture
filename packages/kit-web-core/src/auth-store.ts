import { createStore, type Store } from './store'

export interface AuthState<User> {
  /** unknown = have not yet tried to restore the session from the refresh cookie. */
  status: 'unknown' | 'authenticated' | 'anonymous'
  /** The access token lives only in memory (not localStorage) to reduce XSS surface; the refresh token is in an httpOnly cookie. */
  accessToken: string | null
  user: User | null
}

export type AuthStore<User> = Store<AuthState<User>>

export const createAuthStore = <User>(): AuthStore<User> =>
  createStore<AuthState<User>>({ status: 'unknown', accessToken: null, user: null })
