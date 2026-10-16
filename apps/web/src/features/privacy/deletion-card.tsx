import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
      toast.success(t('privacy.deletion.cancelled'))
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
          <p className="text-sm font-medium">{t('privacy.deletion.running')}</p>
          <Progress
            done={deletion.progress.done}
            total={deletion.progress.total}
            label={t('privacy.deletion.progress')}
          />
          <p className="text-xs text-muted-foreground">
            {t('privacy.deletion.runningParts', {
              done: deletion.progress.done,
              total: deletion.progress.total,
            })}
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
            {t('privacy.deletion.scheduled', { date: formatDate(deletion.scheduledFor) })}
          </p>
          <p className="text-sm text-muted-foreground">{t('privacy.deletion.scheduledText')}</p>
        </div>
      ) : (
        <p className="px-5 py-5 text-sm text-muted-foreground sm:px-6">
          {t('privacy.deletion.explain')}
        </p>
      )}
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {deletion ? t('privacy.deletion.cancelNoConfirm') : t('privacy.deletion.needsConfirm')}
        </p>
        {deletion ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('privacy.deletion.cancel')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            onClick={() => setConfirming(true)}
          >
            {t('privacy.deletion.delete')}
          </Button>
        )}
      </CardFooter>

      {confirming && (
        <Dialog
          title={t('privacy.deletion.dialogTitle')}
          busy={schedule.isPending}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('privacy.deletion.dialogBody')}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={schedule.isPending}
              onClick={() => setConfirming(false)}
            >
              {t('privacy.deletion.keep')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={schedule.isPending}
              onClick={() => schedule.mutate()}
            >
              {t('privacy.deletion.delete')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
