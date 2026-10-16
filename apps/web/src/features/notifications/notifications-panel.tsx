import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bell, CheckCheck, Inbox, LogIn, Mail, Settings, ShieldAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePopoverClose } from '@/components/ui/popover'
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

/** The body of the bell popover: the inbox with mark-as-read, and the way into the notification settings. */
export function NotificationsPanel() {
  const queryClient = useQueryClient()
  const closePopover = usePopoverClose()
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
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border py-2 pr-2 pl-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Notifications</h2>
          {unread > 0 && <Badge variant="accent">{unread} unread</Badge>}
        </div>
        <div className="flex items-center gap-0.5">
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Mark all as read"
              title="Mark all as read"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {!markAll.isPending && <CheckCheck aria-hidden />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Notification settings"
            title="Notification settings"
            asChild
          >
            <Link to="/notifications/settings" onClick={closePopover}>
              <Settings aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      <div className="max-h-[min(28rem,70dvh)] overflow-y-auto overscroll-contain">
        {isPending ? (
          <ul
            aria-busy="true"
            aria-label="Loading notifications"
            className="divide-y divide-border"
          >
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : error ? (
          <p role="alert" className="px-4 py-8 text-center text-sm text-destructive">
            {errorMessage(error)}
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="size-5" aria-hidden />
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
                    'relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3',
                    !n.read && 'bg-accent/40',
                  )}
                >
                  {!n.read && (
                    <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                  )}
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full',
                      className,
                      n.read && 'opacity-60',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
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
                      <p className="text-[13px] leading-relaxed text-muted-foreground">{n.body}</p>
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
                      className="-my-1 -mr-2 h-7 px-2 text-xs"
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
          <div className="flex justify-center border-t border-border p-1.5">
            <Button
              variant="ghost"
              size="sm"
              loading={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              Load older
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
