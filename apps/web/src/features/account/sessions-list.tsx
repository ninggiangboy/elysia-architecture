import { Badge, Button, Card, CardFooter } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { describeDevice } from '@/lib/device'
import { formatDate, formatRelative } from '@/lib/format'
import { revokeOtherSessions, revokeSession, type Session, sessionsQuery } from './queries'

const REVOKE_KEY = ['sessions', 'revoke']
function DeviceIcon({ userAgent }: { userAgent: string | null }) {
  const Icon = /iPad|Tablet/.test(userAgent ?? '')
    ? Tablet
    : /Mobi|iPhone|Android/.test(userAgent ?? '')
      ? Smartphone
      : Monitor
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

export function SessionsList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: sessions } = useSuspenseQuery(sessionsQuery)
  const key = sessionsQuery.queryKey
  // Resync once the last of a quick series of sign-outs is done; an earlier refetch would bring back a device
  // whose sign-out is still on its way.
  const refetch = () => {
    if (queryClient.isMutating({ mutationKey: REVOKE_KEY }) <= 1)
      void queryClient.invalidateQueries({ queryKey: key })
  }
  // Optimistic: the device disappears at once; a failed request brings it back.
  const drop = async (keep: (s: Session) => boolean) => {
    await queryClient.cancelQueries({ queryKey: key })
    const previous = queryClient.getQueryData(key)
    queryClient.setQueryData(key, (list) => list?.filter(keep))
    return { previous }
  }
  const undo = (undoable?: { previous?: Session[] }) => {
    if (undoable?.previous) queryClient.setQueryData(key, undoable.previous)
  }

  const revoke = useMutation({
    mutationKey: REVOKE_KEY,
    mutationFn: revokeSession,
    onMutate: (id) => drop((s) => s.id !== id),
    onSuccess: () => toast.success(t('sessions.signedOut')),
    onError: (err, _id, undoable) => {
      undo(undoable)
      toast.error(errorMessage(err))
    },
    onSettled: refetch,
  })
  const revokeOthers = useMutation({
    mutationKey: REVOKE_KEY,
    mutationFn: revokeOtherSessions,
    onMutate: () => drop((s) => s.current),
    onSuccess: ({ revoked }) => toast.success(t('sessions.signedOutOthers', { count: revoked })),
    onError: (err, _v, undoable) => {
      undo(undoable)
      toast.error(errorMessage(err))
    },
    onSettled: refetch,
  })

  // This device first, then the most recently active.
  const ordered = [...sessions].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt),
  )
  const others = sessions.length - sessions.filter((s) => s.current).length

  return (
    <Card>
      <ul className="divide-y divide-border" data-testid="sessions">
        {ordered.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap sm:px-6"
          >
            <DeviceIcon userAgent={s.userAgent} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="truncate">{describeDevice(s.userAgent)}</span>
                {s.current && <Badge variant="accent">{t('sessions.thisDevice')}</Badge>}
              </p>
              <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']">
                <span>{s.ip ?? t('time.unknownIp')}</span>
                <span title={formatDate(s.lastActiveAt)}>
                  {s.current
                    ? t('sessions.activeNow')
                    : t('sessions.active', { when: formatRelative(s.lastActiveAt) })}
                </span>
                <span title={formatDate(s.startedAt)}>
                  {t('sessions.signedIn', { when: formatRelative(s.startedAt) })}
                </span>
              </p>
            </div>
            {!s.current && (
              <Button
                variant="outline"
                size="sm"
                className="max-sm:w-full"
                onClick={() => revoke.mutate(s.id)}
              >
                {t('sessions.signOut')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {others > 0 ? t('sessions.othersSignedIn', { count: others }) : t('sessions.onlyThis')}
        </p>
        {others > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => revokeOthers.mutate()}
          >
            {t('sessions.signOutOthers')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
