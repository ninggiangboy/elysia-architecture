import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { revokeOtherSessions, revokeSession, type Session, sessionsQuery } from './queries'

const REVOKE_KEY = ['sessions', 'revoke']
type Matchers = ReadonlyArray<readonly [RegExp, string]>

// Order matters: Edge and Chrome UAs also contain "Chrome/" and "Safari/".
const BROWSERS: Matchers = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: Matchers = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]
const detect = (matchers: Matchers, ua: string) => matchers.find(([re]) => re.test(ua))?.[1] ?? null

/** "Chrome on macOS" from a User-Agent; good enough for recognising a device, not for anything security-relevant. */
function describeDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device'
  const browser = detect(BROWSERS, userAgent)
  const os = detect(SYSTEMS, userAgent)
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? userAgent.slice(0, 40)
}

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
    onSuccess: () => toast.success('Device signed out'),
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
    onSuccess: ({ revoked }) =>
      toast.success(`Signed out ${revoked} other ${revoked === 1 ? 'device' : 'devices'}`),
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
          <li key={s.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <DeviceIcon userAgent={s.userAgent} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="truncate">{describeDevice(s.userAgent)}</span>
                {s.current && <Badge variant="accent">This device</Badge>}
              </p>
              <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']">
                <span>{s.ip ?? 'Unknown IP'}</span>
                <span title={formatDate(s.lastActiveAt)}>
                  {s.current ? 'Active now' : `Active ${formatRelative(s.lastActiveAt)}`}
                </span>
                <span title={formatDate(s.startedAt)}>Signed in {formatRelative(s.startedAt)}</span>
              </p>
            </div>
            {!s.current && (
              <Button variant="outline" size="sm" onClick={() => revoke.mutate(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {others > 0
            ? `${others} other ${others === 1 ? 'device is' : 'devices are'} signed in.`
            : 'Only this device is signed in.'}
        </p>
        {others > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => revokeOthers.mutate()}
          >
            Sign out all other devices
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
