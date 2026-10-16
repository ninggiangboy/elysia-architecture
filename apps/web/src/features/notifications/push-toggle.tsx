import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, BellRing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { disablePush, enablePush, type PushState, pushState } from '@/lib/push'
import { cn } from '@/lib/utils'

export const pushStateQuery = { queryKey: ['notifications', 'push-state'], queryFn: pushState }

const COPY = {
  on: { title: 'notifications.push.onTitle', text: 'notifications.push.onText' },
  off: { title: 'notifications.push.offTitle', text: 'notifications.push.offText' },
  denied: { title: 'notifications.push.deniedTitle', text: 'notifications.push.deniedText' },
} as const

/** Turns Web Push on or off for THIS browser. Where it cannot work it says so, rather than leave the page empty. */
export function PushToggle() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: state } = useQuery(pushStateQuery)
  const toggle = useMutation({
    mutationFn: () => (state === 'on' ? disablePush() : enablePush()),
    onSuccess: (next: PushState) => queryClient.setQueryData(pushStateQuery.queryKey, next),
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!state) return null
  if (state === 'unsupported' || state === 'unavailable')
    return (
      <Card className="p-5 text-sm text-muted-foreground sm:px-6" data-testid="push-unsupported">
        {t('notifications.push.unsupported')}
      </Card>
    )

  const on = state === 'on'
  const denied = state === 'denied'
  const copy = COPY[state]
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:px-6">
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg',
          on ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {on ? (
          <BellRing className="size-5" aria-hidden />
        ) : (
          <BellOff className="size-5" aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{t(copy.title)}</p>
        <p
          className="text-sm text-muted-foreground"
          data-testid={denied ? 'push-denied' : undefined}
        >
          {t(copy.text)}
        </p>
      </div>
      {!denied && (
        <Button
          variant={on ? 'outline' : 'default'}
          size="sm"
          className="self-start sm:self-center"
          loading={toggle.isPending}
          onClick={() => toggle.mutate()}
          data-testid="push-toggle"
        >
          {!toggle.isPending && (on ? <BellOff aria-hidden /> : <BellRing aria-hidden />)}
          {on ? t('notifications.push.turnOff') : t('notifications.push.turnOn')}
        </Button>
      )}
    </Card>
  )
}
