import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, Inbox, LogIn, Mail, ShieldAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationsQuery,
  unreadCountQuery,
} from './queries'

const KIND_ICONS: Record<string, { icon: typeof Bell; className: string }> = {
  welcome: { icon: Sparkles, className: 'bg-accent text-accent-foreground' },
  email_changed: { icon: Mail, className: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  new_sign_in: { icon: LogIn, className: 'bg-success/12 text-success' },
  security_alert: { icon: ShieldAlert, className: 'bg-destructive/10 text-destructive' },
}
const DEFAULT_ICON = { icon: Bell, className: 'bg-muted text-muted-foreground' }

export function NotificationsList() {
  const queryClient = useQueryClient()
  const { data, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(notificationsQuery)
  const { data: unread = 0 } = useQuery(unreadCountQuery)
  const refetch = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refetch,
  })
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refetch,
  })

  const items = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Inbox</h2>
          {unread > 0 && <Badge variant="accent">{unread} unread</Badge>}
        </div>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {!markAll.isPending && <CheckCheck aria-hidden />} Mark all as read
          </Button>
        )}
      </div>

      {isPending ? (
        <ul aria-busy="true" aria-label="Loading notifications" className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-4 px-5 py-4 sm:px-6">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : error ? (
        <p role="alert" className="px-6 py-10 text-center text-sm text-destructive">
          {errorMessage(error)}
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">You have no notifications yet.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border" data-testid="notifications">
          {items.map((n) => {
            const { icon: Icon, className } = KIND_ICONS[n.kind] ?? DEFAULT_ICON
            return (
              <li
                key={n.id}
                data-read={n.read}
                className={cn(
                  'relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6',
                  !n.read && 'bg-accent/40',
                )}
              >
                {!n.read && (
                  <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                )}
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full',
                    className,
                    n.read && 'opacity-60',
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    {!n.read && <span className="sr-only">Unread: </span>}
                    <span
                      className={cn(
                        'font-medium',
                        n.read ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {n.title}
                    </span>
                    {n.count > 1 && <Badge>×{n.count}</Badge>}
                  </p>
                  {n.body && (
                    <p className="text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                  )}
                  <time
                    dateTime={n.createdAt}
                    title={formatDate(n.createdAt)}
                    className="mt-0.5 text-xs text-muted-foreground"
                  >
                    {formatRelative(n.createdAt)}
                  </time>
                </div>
                {!n.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="col-start-2 -ml-3 justify-self-start sm:col-start-3 sm:row-start-1 sm:-my-1 sm:ml-0"
                    loading={markRead.isPending && markRead.variables === n.id}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {hasNextPage && (
        <CardFooter className="justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            Load older
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
