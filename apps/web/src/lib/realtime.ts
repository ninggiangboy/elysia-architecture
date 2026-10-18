import { apiOrigin, createRealtimeClient } from '@kit/web-core'
import { authStore } from './auth-store'
import { watchNetworkFailure, watchResponse } from './maintenance'
import { refreshSession } from './session'

export type {
  RealtimeHandle,
  RealtimeListener,
  RealtimeMessage,
  RealtimeStatus,
} from '@kit/web-core'

/** Server-Sent Events from the API, signed in with the access token and kept alive through refreshes and outages. */
export const connectSse = createRealtimeClient({
  url: () => `${apiOrigin()}/api/realtime/events`,
  store: authStore,
  refresh: refreshSession,
  onResponse: watchResponse,
  onNetworkFailure: watchNetworkFailure,
})
