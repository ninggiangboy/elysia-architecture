import type { App } from '@app/api'
import type { ApiErrorBody } from '@app/shared-types/api-error'
import {
  AVATAR_MAX_BYTES,
  BIO_MAX,
  COVER_MAX_BYTES,
  DISPLAY_NAME_MAX,
} from '@app/shared-types/profile'
import { treaty } from '@elysiajs/eden'
import { currentLocale, i18n } from '@/i18n'
import { authStore } from './auth-store'
import { apiOrigin } from './config'
import { watchNetworkFailure, watchResponse } from './maintenance'
import { refreshSession } from './session'

const isAuthEndpoint = (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('/api/auth/')

/**
 * Dev only: mutations get 300-800ms of latency so loading/pending states are visible and feel like a real network.
 * Skipped under automation (Playwright sets navigator.webdriver) so e2e runs stay fast.
 */
const simulateLatency = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!import.meta.env.DEV || navigator.webdriver) return
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method === 'GET' || method === 'HEAD') return
  await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 500))
}

/** fetch with a Bearer token; on 401 it refreshes (single-flight) and retries exactly once. */
const authFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const send = () => {
    const headers = new Headers(init?.headers)
    const token = authStore.get().accessToken
    if (token) headers.set('authorization', `Bearer ${token}`)
    // Lets the server write its answers (and, for a new account, its mail) in the language the app is showing.
    headers.set('accept-language', currentLocale())
    return fetch(input, { ...init, headers, credentials: 'include' })
  }
  // A request that gets no answer at all may mean the API is down: have a look (without holding up the caller's error).
  const sendWatched = async () => {
    try {
      return await send()
    } catch (err) {
      void watchNetworkFailure(err)
      throw err
    }
  }
  await simulateLatency(input, init)
  let res = await sendWatched()
  if (res.status === 401 && !isAuthEndpoint(input) && authStore.get().accessToken) {
    if (await refreshSession()) res = await sendWatched()
  }
  await watchResponse(res)
  return res
}) as typeof fetch // bun-types adds `preconnect` to typeof fetch; cast to match

/** Fully typed client inferred from the backend (Eden Treaty) — change the API on the server and the web app fails to compile. */
export const http = treaty<App>(apiOrigin(), { fetcher: authFetch })

const MB = 1024 * 1024
/** The numbers some error messages quote (the server's rules, shared through `@app/shared-types`). */
const LIMITS = {
  displayNameMax: DISPLAY_NAME_MAX,
  bioMax: BIO_MAX,
  avatarMb: AVATAR_MAX_BYTES / MB,
  coverMb: COVER_MAX_BYTES / MB,
}

// The key comes from the server at run time, so it cannot be one of the typed literal keys.
const translateDynamic = i18n.t.bind(i18n) as (key: string, options?: object) => string

/** What to show for an API error: our translation of its `code`, else the server's own text, else a generic line. */
function apiErrorMessage(code: string | undefined, serverMessage: string | undefined): string {
  const key = `errors.${code}`
  if (code && i18n.exists(key)) return translateDynamic(key, LIMITS)
  return serverMessage ?? i18n.t('common.unknownError')
}

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
      apiErrorMessage(value?.error?.code, value?.error?.message),
      status,
    )
  }
  return res.data as NonNullable<R['data']>
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : i18n.t('common.unknownError')
