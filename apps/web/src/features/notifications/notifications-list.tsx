import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationsQuery,
  unreadCountQuery,
} from './queries'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function NotificationsList() {
  const queryClient = useQueryClient()
  const { data, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(notificationsQuery)
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

  if (isPending) return <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
  if (error)
    return (
      <p role="alert" className="mt-4 text-sm text-destructive">
        {errorMessage(error)}
      </p>
    )

  const items = data.pages.flatMap((p) => p.items)
  const unread = queryClient.getQueryData(unreadCountQuery.queryKey) ?? 0
  if (items.length === 0)
    return <p className="mt-4 text-sm text-muted-foreground">You have no notifications yet.</p>

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={markAll.isPending || unread === 0}
        onClick={() => markAll.mutate()}
      >
        <CheckCheck className="size-4" aria-hidden /> Mark all as read
      </Button>
      <ul className="flex flex-col divide-y divide-border" data-testid="notifications">
        {items.map((n) => (
          <li
            key={n.id}
            data-read={n.read}
            className={cn('flex items-start justify-between gap-4 py-3', n.read && 'opacity-60')}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {!n.read && (
                  <>
                    <span
                      aria-hidden
                      className="mr-2 inline-block size-2 rounded-full bg-primary align-middle"
                    />
                    <span className="sr-only">Unread: </span>
                  </>
                )}
                {n.title}
                {n.count > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground">×{n.count}</span>
                )}
              </p>
              {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.createdAt)}</p>
            </div>
            {!n.read && (
              <Button
                variant="ghost"
                size="sm"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(n.id)}
              >
                Mark read
              </Button>
            )}
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          Load older
        </Button>
      )}
    </div>
  )
}
