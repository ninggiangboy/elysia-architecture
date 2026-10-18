import type { App } from '@app/api'
import { treaty } from '@elysiajs/eden'
import { apiOrigin, createAuthFetch, createUnwrap } from '@kit/web-core'
import { AVATAR_MAX_BYTES, BIO_MAX, COVER_MAX_BYTES, DISPLAY_NAME_MAX } from '@mod/profile/public'
import { currentLocale, i18n } from '@/i18n'
import { authStore } from './auth-store'
import { watchNetworkFailure, watchResponse } from './maintenance'
import { refreshSession } from './session'

export { ApiError } from '@kit/web-core'

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

const authFetch = createAuthFetch({
  store: authStore,
  refresh: refreshSession,
  locale: currentLocale,
  isAuthEndpoint,
  onNetworkFailure: watchNetworkFailure,
  onResponse: watchResponse,
  beforeSend: simulateLatency,
})

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

export const unwrap = createUnwrap(apiErrorMessage)

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : i18n.t('common.unknownError')
