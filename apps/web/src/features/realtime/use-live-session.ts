import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { sessionsQuery } from '@/features/account/queries'
import { connectSse } from '@/lib/realtime'
import { clearSession } from '@/lib/session'

/**
 * App-wide live channel (SSE) for a signed-in user:
 *  - this device was signed out remotely → sign out here immediately instead of waiting for the access token to expire;
 *  - another device signed out → refresh the device list;
 *  - a notification arrived or was read elsewhere → refresh the badge and the list;
 *  - every (re)connect refetches both, because events sent while disconnected are not replayed.
 */
export function useLiveSession() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // biome-ignore lint/correctness/useExhaustiveDependencies: one connection per mounted layout; both are stable
  useEffect(() => {
    let ownSessionId: unknown
    const refreshDevices = () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    const refreshNotifications = () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] })

    const connection = connectSse({
      onMessage(m) {
        if (m.type === 'ready') {
          ownSessionId = m.data?.sessionId
          void refreshDevices()
          void refreshNotifications()
        } else if (m.type === 'notification.created') {
          toast(String(m.data?.title ?? 'New notification'))
          void refreshNotifications()
        } else if (m.type === 'notification.read') {
          void refreshNotifications()
        } else if (m.type === 'session.revoked') {
          if (m.data?.sessionId !== ownSessionId) return void refreshDevices()
          toast.warning('This device was signed out from another device')
          clearSession()
          queryClient.clear()
          void navigate({ to: '/login' })
        }
      },
    })
    return () => connection.close()
  }, [])
}
