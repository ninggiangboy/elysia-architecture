import type { App } from '@app/api'
import type { ApiErrorBody } from '@app/shared-types'
import { treaty } from '@elysiajs/eden'
import { authStore } from './auth-store'
import { apiOrigin } from './config'
import { refreshSession } from './session'

const isAuthEndpoint = (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('/api/auth/')

/** fetch with a Bearer token; on 401 it refreshes (single-flight) and retries exactly once. */
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
}) as typeof fetch // bun-types adds `preconnect` to typeof fetch; cast to match

/** Fully typed client inferred from the backend (Eden Treaty) — change the API on the server and the web app fails to compile. */
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
      value?.error?.message ?? 'Something went wrong, please try again',
      status,
    )
  }
  return res.data as NonNullable<R['data']>
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong, please try again'
