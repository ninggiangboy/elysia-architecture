import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NotificationsPanel } from './notifications-panel'
import { markNotificationsSeen, unseenCountQuery } from './queries'

/**
 * Header bell; opens the inbox in a popover. The badge counts what is UNSEEN (arrived since the list was last opened),
 * not what is unread: opening the popover zeroes it, while each notification keeps its own read state.
 * Kept fresh by `useLiveSession`.
 */
export function NotificationBell() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: unseen = 0 } = useQuery(unseenCountQuery)

  const markSeen = useMutation({
    mutationFn: markNotificationsSeen,
    onMutate: () => queryClient.setQueryData(unseenCountQuery.queryKey, 0),
    onSettled: () => queryClient.invalidateQueries({ queryKey: unseenCountQuery.queryKey }),
  })

  // Also covers a notification arriving while the popover is open: the user is looking at it, so it is seen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `markSeen` is a new object every render; only the two inputs matter
  useEffect(() => {
    if (open && unseen > 0) markSeen.mutate()
  }, [open, unseen])

  return (
    <Popover onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unseen > 0 ? t('notifications.newCount', { count: unseen }) : t('notifications.title')
        }
        title={t('notifications.title')}
        className="relative grid size-10 place-items-center sm:size-9 rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground"
      >
        <Bell className="size-[18px]" aria-hidden />
        {unseen > 0 && (
          <span
            data-testid="unseen-badge"
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground ring-2 ring-background"
          >
            {unseen > 99 ? '99+' : unseen}
          </span>
        )}
      </PopoverTrigger>
      {/* On phones the bell is not at the screen edge: pin the panel to the (blurred, hence containing) header instead. */}
      <PopoverContent
        className="w-96 max-sm:fixed max-sm:inset-x-4 max-sm:top-[3.75rem] max-sm:mt-0 max-sm:w-auto"
        aria-label={t('notifications.title')}
      >
        <NotificationsPanel />
      </PopoverContent>
    </Popover>
  )
}
