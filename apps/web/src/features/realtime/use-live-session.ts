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
 *  - every (re)connect refetches it, because events sent while disconnected are not replayed.
 */
export function useLiveSession() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // biome-ignore lint/correctness/useExhaustiveDependencies: one connection per mounted layout; both are stable
  useEffect(() => {
    let ownSessionId: unknown
    const refreshDevices = () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })

    const connection = connectSse({
      onMessage(m) {
        if (m.type === 'ready') {
          ownSessionId = m.data?.sessionId
          void refreshDevices()
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
