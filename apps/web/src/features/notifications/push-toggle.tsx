import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'
import { disablePush, enablePush, type PushState, pushState } from '@/lib/push'

const pushStateQuery = { queryKey: ['notifications', 'push-state'], queryFn: pushState }

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
  if (state === 'denied')
    return (
      <p className="text-sm text-muted-foreground" data-testid="push-denied">
        Browser notifications are blocked for this site. Allow them in your browser's site settings
        to get alerts here.
      </p>
    )

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">
        {state === 'on'
          ? 'This browser shows a system notification when something happens, even when the app is closed.'
          : 'Get a system notification on this browser, even when the app is closed.'}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        data-testid="push-toggle"
      >
        {state === 'on' ? (
          <>
            <BellOff className="size-4" aria-hidden /> Turn off
          </>
        ) : (
          <>
            <BellRing className="size-4" aria-hidden /> Turn on
          </>
        )}
      </Button>
    </div>
  )
}
