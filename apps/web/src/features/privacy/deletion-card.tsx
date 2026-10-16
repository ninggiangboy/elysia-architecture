import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Progress } from './progress'
import { cancelDeletion, deletionQuery, scheduleDeletion } from './queries'

export function DeletionCard() {
  const queryClient = useQueryClient()
  const { data: deletion } = useSuspenseQuery(deletionQuery)
  const [confirming, setConfirming] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: deletionQuery.queryKey })

  const schedule = useMutation({
    mutationFn: scheduleDeletion,
    onSuccess: () => {
      setConfirming(false)
      void refresh()
    },
    onError: (err) => {
      setConfirming(false)
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })
  const cancel = useMutation({
    mutationFn: cancelDeletion,
    onSuccess: () => {
      toast.success('Your account will not be deleted')
      void refresh()
    },
    onError: (err) => {
      toast.error(errorMessage(err))
      void refresh()
    },
  })

  if (deletion?.status === 'running') {
    return (
      <Card>
        <div className="flex flex-col gap-3 px-5 py-5 sm:px-6" data-testid="deletion-running">
          <p className="text-sm font-medium">Your account is being deleted</p>
          <Progress
            done={deletion.progress.done}
            total={deletion.progress.total}
            label="Deletion progress"
          />
          <p className="text-xs text-muted-foreground">
            {deletion.progress.done} of {deletion.progress.total} parts erased. This can no longer
            be cancelled; you will be signed out when it is done.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      {deletion ? (
        <div className="flex flex-col gap-1 px-5 py-5 sm:px-6" data-testid="deletion-scheduled">
          <p className="text-sm font-medium">
            Your account will be deleted on {formatDate(deletion.scheduledFor)}
          </p>
          <p className="text-sm text-muted-foreground">
            Until then everything works as usual, and you can change your mind.
          </p>
        </div>
      ) : (
        <p className="px-5 py-5 text-sm text-muted-foreground sm:px-6">
          Deleting your account erases your profile, your files, your notifications and your sign-in
          methods. We wait before we start, so you can still change your mind.
        </p>
      )}
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {deletion ? 'Cancelling does not need a confirmation.' : 'Asks you to confirm it is you.'}
        </p>
        {deletion ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel the deletion
          </Button>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            onClick={() => setConfirming(true)}
          >
            Delete my account
          </Button>
        )}
      </CardFooter>

      {confirming && (
        <Dialog
          title="Delete your account?"
          busy={schedule.isPending}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your account and everything in it will be erased for good once the waiting period is
            over. We email you now, and you can cancel from this page until then. Want a copy first?
            Request an export above.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={schedule.isPending}
              onClick={() => setConfirming(false)}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={schedule.isPending}
              onClick={() => schedule.mutate()}
            >
              Delete my account
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
