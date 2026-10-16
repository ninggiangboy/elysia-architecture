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
      className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
