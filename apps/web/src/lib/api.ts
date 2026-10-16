import type { App } from '@app/api'
import type { ApiErrorBody } from '@app/shared-types'
import { treaty } from '@elysiajs/eden'
import { authStore } from './auth-store'
import { apiOrigin } from './config'
import { refreshSession } from './session'

const isAuthEndpoint = (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('/api/auth/')

/** fetch gắn Bearer; gặp 401 thì refresh (single-flight) rồi thử lại đúng một lần. */
const authFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const send = () => {
    const headers = new Headers(init?.headers)
    const token = authStore.get().accessToken
    if (token) headers.set('authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers, credentials: 'include' })
  }
  const res = await send()
  if (res.status === 401 && !isAuthEndpoint(input) && authStore.get().accessToken) {
    if (await refreshSession()) return send()
  }
  return res
}) as typeof fetch // bun-types thêm `preconnect` vào typeof fetch; ép kiểu để khớp

/** Client có type đầy đủ suy ra từ backend (Eden Treaty) — đổi API ở server là web báo lỗi compile. */
export const http = treaty<App>(apiOrigin(), { fetcher: authFetch })

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function unwrap<R extends { data: unknown; error: unknown }>(
  res: R,
): NonNullable<R['data']> {
  if (res.error) {
    const { status, value } = res.error as { status: number; value: ApiErrorBody | undefined }
    throw new ApiError(
      value?.error?.code ?? 'unknown_error',
      value?.error?.message ?? 'Có lỗi xảy ra, vui lòng thử lại',
      status,
    )
  }
  return res.data as NonNullable<R['data']>
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại'
