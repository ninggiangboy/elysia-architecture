import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { unreadCountQuery } from './queries'

/** Header link to the notifications page, with the unread badge. Kept fresh by `useLiveSession`. */
export function NotificationBell() {
  const { data: unread = 0 } = useQuery(unreadCountQuery)
  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      title="Notifications"
      className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 [&.active]:bg-muted [&.active]:text-foreground"
    >
      <Bell className="size-[18px]" aria-hidden />
      {unread > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground ring-2 ring-background"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
