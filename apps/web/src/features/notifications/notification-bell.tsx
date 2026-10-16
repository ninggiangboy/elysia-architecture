import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NotificationsPanel } from './notifications-panel'
import { unreadCountQuery } from './queries'

/** Header bell with the unread badge; opens the inbox in a popover. Kept fresh by `useLiveSession`. */
export function NotificationBell() {
  const { data: unread = 0 } = useQuery(unreadCountQuery)
  return (
    <Popover>
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground"
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
      </PopoverTrigger>
      {/* On phones the bell is not at the screen edge: pin the panel to the (blurred, hence containing) header instead. */}
      <PopoverContent
        className="w-96 max-sm:fixed max-sm:inset-x-4 max-sm:top-[3.75rem] max-sm:mt-0 max-sm:w-auto"
        aria-label="Notifications"
      >
        <NotificationsPanel />
      </PopoverContent>
    </Popover>
  )
}
