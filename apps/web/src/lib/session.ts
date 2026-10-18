import { apiOrigin, createSession } from '@kit/web-core'
import { authStore } from './auth-store'

export const { applySession, applyAccessToken, clearSession, refreshSession, ensureSession } =
  createSession({ store: authStore, refreshUrl: () => `${apiOrigin()}/api/auth/refresh` })
