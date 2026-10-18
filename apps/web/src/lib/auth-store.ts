import { type AuthState, createAuthStore } from '@kit/web-core'
import { useStore } from '@kit/web-core/react'

export interface AuthUser {
  id: string
  email: string
}

export type { AuthState }

export const authStore = createAuthStore<AuthUser>()

export const useAuth = () => useStore(authStore)
