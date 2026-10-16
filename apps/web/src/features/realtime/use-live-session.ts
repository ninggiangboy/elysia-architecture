import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { sessionsQuery } from '@/features/account/queries'
import { applyCreated, applyRead, applySeen } from '@/features/notifications/live-cache'
import { liveTitle } from '@/features/notifications/text'
import { i18n } from '@/i18n'
import { forgetPush, syncPush } from '@/lib/push'
import { connectSse, type RealtimeMessage } from '@/lib/realtime'
import { clearSession } from '@/lib/session'

/** After a toast, further notifications within this window only update the badge and list (security alerts excepted). */
const TOAST_QUIET_MS = 30_000

/**
 * App-wide live channel (SSE) for a signed-in user:
 *  - this device was signed out remotely → sign out here immediately instead of waiting for the access token to expire;
 *  - another device signed out → refresh the device list;
 *  - a notification arrived or was read elsewhere → patch it into the cached list and refresh the badge (no list refetch);
 *  - steps of a long job (`privacy.*`: the data export, the account erasure) refetch the job's state; those events ARE
 *    replayed, so a tab that was away still sees how the job went. `done` in them is a count, never a step number:
 *    delivery order is not guaranteed;
 *  - `billing.topup`: a top-up settled, so the balance and the history refetch (replayed, like the privacy steps);
 *  - every (re)connect refetches both, because those events are not replayed; only `session.revoked` and the `privacy.*`
 *    steps are, so a device that was offline when it was signed out finds out as soon as it reconnects.
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
    const refreshPrivacy = () => queryClient.invalidateQueries({ queryKey: ['privacy'] })
    const refreshBilling = () => queryClient.invalidateQueries({ queryKey: ['billing'] })

    const signOutHere = () => {
      toast.warning(i18n.t('notifications.live.signedOut'))
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
        void refreshPrivacy()
        void refreshBilling()
      },
      'privacy.export.progress': () => void refreshPrivacy(),
      'privacy.export.failed': () => void refreshPrivacy(),
      'privacy.export.ready'() {
        toast.success(i18n.t('notifications.live.exportReady'))
        void refreshPrivacy()
      },
      'privacy.deletion.changed': () => void refreshPrivacy(),
      'privacy.deletion.progress'(data) {
        void refreshPrivacy()
        // The last part erased: the account is gone, so is this session's reason to exist.
        if (data && data.done === data.total) {
          toast.success(i18n.t('notifications.live.deleted'))
          void forgetPush()
          clearSession()
          queryClient.clear()
          void navigate({ to: '/login' })
        }
      },
      // The webhook settled a top-up (maybe from another tab or device): the balance and the history are stale.
      'billing.topup': () => void refreshBilling(),
      'notification.created'(data) {
        const now = Date.now()
        if (data?.kind === 'security_alert' || now - lastToastAt >= TOAST_QUIET_MS) {
          lastToastAt = now
          toast(liveTitle(data))
        }
        void applyCreated(queryClient, data)
      },
      'notification.read'(data) {
        void applyRead(queryClient, data)
      },
      // The list was opened on another device: this one's badge is stale.
      'notification.seen'() {
        void applySeen(queryClient)
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
