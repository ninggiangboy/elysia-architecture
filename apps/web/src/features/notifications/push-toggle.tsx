import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { disablePush, enablePush, type PushState, pushState } from '@/lib/push'
import { cn } from '@/lib/utils'

const pushStateQuery = { queryKey: ['notifications', 'push-state'], queryFn: pushState }

const COPY: Record<'on' | 'off' | 'denied', { title: string; text: string }> = {
  on: {
    title: 'Browser notifications are on',
    text: 'This browser shows a system notification when something happens, even when the app is closed.',
  },
  off: {
    title: 'Browser notifications are off',
    text: 'Get a system notification on this browser, even when the app is closed.',
  },
  denied: {
    title: 'Browser notifications are blocked',
    text: "Allow them in your browser's site settings to get alerts here.",
  },
}

/** Turns Web Push on or off for THIS browser. Renders nothing where it cannot work. */
export function PushToggle() {
  const queryClient = useQueryClient()
  const { data: state } = useQuery(pushStateQuery)
  const toggle = useMutation({
    mutationFn: () => (state === 'on' ? disablePush() : enablePush()),
    onSuccess: (next: PushState) => queryClient.setQueryData(pushStateQuery.queryKey, next),
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!state || state === 'unsupported' || state === 'unavailable') return null

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
        <p className="text-sm font-medium">{copy.title}</p>
        <p
          className="text-sm text-muted-foreground"
          data-testid={denied ? 'push-denied' : undefined}
        >
          {copy.text}
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
          {on ? 'Turn off' : 'Turn on'}
        </Button>
      )}
    </Card>
  )
}
