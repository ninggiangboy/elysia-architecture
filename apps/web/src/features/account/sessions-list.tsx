import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { revokeOtherSessions, revokeSession, sessionsQuery } from './queries'

/** "Chrome on macOS" from a User-Agent; good enough for recognising a device, not for anything security-relevant. */
function describeDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? userAgent.slice(0, 40)
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function SessionsList() {
  const queryClient = useQueryClient()
  const { data: sessions } = useSuspenseQuery(sessionsQuery)
  const refetch = () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => toast.success('Device signed out'),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refetch,
  })
  const revokeOthers = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: ({ revoked }) => toast.success(`Signed out ${revoked} other device(s)`),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refetch,
  })

  const others = sessions.filter((s) => !s.current)

  return (
    <div className="mt-4 flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border" data-testid="sessions">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {describeDevice(s.userAgent)}
                {s.current && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                    This device
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.ip ?? 'Unknown IP'} · signed in {formatDate(s.startedAt)} · active{' '}
                {formatDate(s.lastActiveAt)}
              </p>
            </div>
            {!s.current && (
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(s.id)}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <Button
          variant="outline"
          className="self-start"
          disabled={revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
        >
          Sign out all other devices
        </Button>
      )}
    </div>
  )
}
