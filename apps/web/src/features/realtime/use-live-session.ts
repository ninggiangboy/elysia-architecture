import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { sessionsQuery } from '@/features/account/queries'
import { forgetPush, syncPush } from '@/lib/push'
import { connectSse, type RealtimeMessage } from '@/lib/realtime'
import { clearSession } from '@/lib/session'

/** After a toast, further notifications within this window only update the badge and list (security alerts excepted). */
const TOAST_QUIET_MS = 30_000

/**
 * App-wide live channel (SSE) for a signed-in user:
 *  - this device was signed out remotely → sign out here immediately instead of waiting for the access token to expire;
 *  - another device signed out → refresh the device list;
 *  - a notification arrived or was read elsewhere → refresh the badge and the list;
 *  - every (re)connect refetches both, because those events are not replayed; only `session.revoked` is, so a device that
 *    was offline when it was signed out finds out as soon as it reconnects.
 */
export function useLiveSession() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Keeps this browser's push subscription tied to the current login session.
  useEffect(() => {
    void syncPush().catch(() => {})
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: one connection per mounted layout; both are stable
  useEffect(() => {
    let ownSessionId: unknown
    let lastToastAt = 0
    const refreshDevices = () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    const refreshNotifications = () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] })

    const signOutHere = () => {
      toast.warning('This device was signed out from another device')
      void forgetPush()
      clearSession()
      queryClient.clear()
      void navigate({ to: '/login' })
    }

    const handlers: Record<string, (data: RealtimeMessage['data']) => void> = {
      ready(data) {
        ownSessionId = data?.sessionId
        void refreshDevices()
        void refreshNotifications()
      },
      'notification.created'(data) {
        const now = Date.now()
        if (data?.kind === 'security_alert' || now - lastToastAt >= TOAST_QUIET_MS) {
          lastToastAt = now
          toast(String(data?.title ?? 'New notification'))
        }
        void refreshNotifications()
      },
      'notification.read'() {
        void refreshNotifications()
      },
      // The list was opened on another device: this one's badge is stale.
      'notification.seen'() {
        void refreshNotifications()
      },
      'session.revoked'(data) {
        if (data?.sessionId === ownSessionId) signOutHere()
        else void refreshDevices()
      },
    }

    const connection = connectSse({ onMessage: (m) => handlers[m.type]?.(m.data) })
    return () => connection.close()
  }, [])
}
