import { type AuthUser, authStore } from './auth-store'
import { apiOrigin } from './config'

interface SessionResponse {
  accessToken: string
  user: AuthUser
}

export function applySession(data: SessionResponse) {
  authStore.set({ status: 'authenticated', accessToken: data.accessToken, user: data.user })
}

export function clearSession() {
  authStore.set({ status: 'anonymous', accessToken: null, user: null })
}

let inflight: Promise<boolean> | null = null

/**
 * Đổi refresh cookie lấy access token mới. Single-flight: nhiều request cùng gặp 401 chỉ gọi refresh MỘT lần
 * (refresh token xoay vòng nên gọi song song sẽ làm hỏng phiên).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      // Dùng fetch thô (không qua api client) để tránh vòng lặp interceptor.
      const res = await fetch(`${apiOrigin()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
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

/** Gọi trước khi vào route cần đăng nhập: khôi phục phiên từ cookie nếu chưa biết trạng thái. */
export async function ensureSession(): Promise<boolean> {
  const { status } = authStore.get()
  if (status !== 'unknown') return status === 'authenticated'
  return refreshSession()
}
