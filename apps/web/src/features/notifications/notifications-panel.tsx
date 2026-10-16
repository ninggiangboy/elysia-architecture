import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import {
  Bell,
  CheckCheck,
  Inbox,
  LogIn,
  Mail,
  Settings,
  ShieldAlert,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePopoverClose } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { readOptimistically } from './live-cache'
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationsPage,
  notificationsQuery,
  unreadCountQuery,
} from './queries'
import { notificationText } from './text'

const KIND_ICONS: Record<string, { icon: typeof Bell; className: string }> = {
  welcome: { icon: Sparkles, className: 'bg-accent text-accent-foreground' },
  email_changed: { icon: Mail, className: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  new_sign_in: { icon: LogIn, className: 'bg-success/12 text-success' },
  security_alert: { icon: ShieldAlert, className: 'bg-destructive/10 text-destructive' },
  payment: { icon: Wallet, className: 'bg-success/12 text-success' },
}
const READ_KEY = ['notifications', 'mark-read']

/** Where a notification leads, if anywhere. Only paths inside this app, like the push handler accepts. */
const targetOf = (data: Record<string, unknown>) =>
  typeof data.link === 'string' && data.link.startsWith('/') && data.link !== '/' ? data.link : null

/** Newer than this counts as "just arrived". */
const FRESH_MS = 10_000
const DEFAULT_ICON = { icon: Bell, className: 'bg-muted text-muted-foreground' }

/** The body of the bell popover: the inbox with mark-as-read, and the way into the notification settings. */
export function NotificationsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const closePopover = usePopoverClose()
  const router = useRouter()
  const { data, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(notificationsQuery)
  const { data: unread = 0 } = useQuery(unreadCountQuery)
  // Resync with the server once the last of a quick series of reads is done; earlier ones would undo the later ones.
  const refetch = () => {
    if (queryClient.isMutating({ mutationKey: READ_KEY }) <= 1)
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  // Optimistic: the list and counts change at once; a failed request puts them back.
  const markRead = useMutation({
    mutationKey: READ_KEY,
    mutationFn: markNotificationRead,
    onMutate: (id) => readOptimistically(queryClient, id),
    onError: (err, _id, undo) => {
      undo?.rollback()
      toast.error(errorMessage(err))
    },
    onSettled: refetch,
  })
  const markAll = useMutation({
    mutationKey: READ_KEY,
    mutationFn: markAllNotificationsRead,
    onMutate: () => readOptimistically(queryClient, null),
    onError: (err, _v, undo) => {
      undo?.rollback()
      toast.error(errorMessage(err))
    },
    onSettled: refetch,
  })

  const items = data?.pages.flatMap((p) => p.items) ?? []

  // Opening a notification is reading it: take the person to what it is about and mark it read on the way.
  const open = (id: string, read: boolean, target: string) => {
    if (!read) markRead.mutate(id)
    closePopover()
    router.history.push(target)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border py-2 pr-2 pl-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{t('notifications.title')}</h2>
          {unread > 0 && (
            <Badge variant="accent">{t('notifications.unread', { count: unread })}</Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 sm:size-8"
              aria-label={t('notifications.markAll')}
              title={t('notifications.markAll')}
              disabled={unread === 0}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 sm:size-8"
            aria-label={t('notifications.settings')}
            title={t('notifications.settings')}
            asChild
          >
            <Link to="/settings/notifications" onClick={closePopover}>
              <Settings aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      <div className="max-h-[min(28rem,70dvh)] overflow-y-auto overscroll-contain">
        {isPending ? (
          <ul
            aria-busy="true"
            aria-label={t('notifications.loading')}
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
              <p className="text-sm font-medium">{t('notifications.caughtUp')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('notifications.empty')}</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border" data-testid="notifications">
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                onOpen={(target) => open(n.id, n.read, target)}
                onMarkRead={() => markRead.mutate(n.id)}
              />
            ))}
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
              {t('notifications.loadOlder')}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

type Item = NotificationsPage['items'][number]

/** One row of the inbox: icon, text (a button when it leads somewhere), and the mark-as-read action. */
function NotificationItem({
  n,
  onOpen,
  onMarkRead,
}: {
  n: Item
  onOpen: (target: string) => void
  onMarkRead: () => void
}) {
  const { t } = useTranslation()
  const { icon: Icon, className } = KIND_ICONS[n.kind] ?? DEFAULT_ICON
  const text = notificationText(n)
  const target = targetOf(n.data)
  const content = (
    <>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        {!n.read && <span className="sr-only">{t('notifications.unreadPrefix')}</span>}
        <span className={cn('font-medium', n.read ? 'text-muted-foreground' : 'text-foreground')}>
          {text.title}
        </span>
        {n.count > 1 && <Badge>×{n.count}</Badge>}
      </p>
      {text.body && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{text.body}</p>
      )}
      <time
        dateTime={n.createdAt}
        title={formatDate(n.createdAt)}
        className="mt-0.5 text-xs text-muted-foreground"
      >
        {formatRelative(n.createdAt)}
      </time>
    </>
  )
  return (
    <li
      key={n.id}
      data-read={n.read}
      className={cn(
        'relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3',
        !n.read && 'bg-accent/40',
        // A notification that just arrived over the live stream eases in; an old one never matches.
        Date.now() - Date.parse(n.createdAt) < FRESH_MS &&
          'motion-safe:animate-[item-in_0.25s_ease-out]',
      )}
    >
      {!n.read && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full',
          className,
          n.read && 'opacity-60',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {target ? (
        <button
          type="button"
          onClick={() => onOpen(target)}
          className="-m-1 flex min-w-0 flex-col gap-0.5 rounded-md p-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">{content}</div>
      )}
      {!n.read && (
        <Button
          variant="ghost"
          size="sm"
          className="-my-1.5 -mr-2 h-8 px-2.5 text-xs sm:-my-1 sm:h-7 sm:px-2"
          onClick={onMarkRead}
        >
          {t('notifications.markRead')}
        </Button>
      )}
    </li>
  )
}
