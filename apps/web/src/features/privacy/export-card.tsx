import { Badge, Button, Card, CardFooter } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { Download, FileArchive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'
import { Progress } from './progress'
import { type DataExport, exportDownloadUrl, exportsQuery, requestExport } from './queries'

const STATUS = {
  collecting: { label: 'privacy.export.collecting', variant: 'default' },
  assembling: { label: 'privacy.export.assembling', variant: 'default' },
  ready: { label: 'privacy.export.ready', variant: 'success' },
  failed: { label: 'privacy.export.failed', variant: 'warning' },
  expired: { label: 'privacy.export.expired', variant: 'default' },
} as const satisfies Record<
  DataExport['status'],
  { label: string; variant: 'default' | 'success' | 'warning' }
>

const inProgress = (e: DataExport) => e.status === 'collecting' || e.status === 'assembling'

/** The line under the date: what the user needs to know about this export right now. */
function summary(e: DataExport, t: TFunction): string {
  switch (e.status) {
    case 'ready': {
      const date = e.expiresAt ? formatDate(e.expiresAt) : '—'
      return e.size
        ? t('privacy.export.readySummarySized', { size: formatBytes(e.size), date })
        : t('privacy.export.readySummary', { date })
    }
    case 'failed':
      return t('privacy.export.failedSummary')
    case 'expired':
      return t('privacy.export.expiredSummary')
    default:
      return t('privacy.export.parts', { done: e.progress.done, total: e.progress.total })
  }
}

function ExportRow({
  item: e,
  downloading,
  onDownload,
}: {
  item: DataExport
  downloading: boolean
  onDownload: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:px-6" data-testid="export">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <FileArchive className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t('privacy.export.requested', { date: formatDate(e.requestedAt) })}
            <Badge variant={STATUS[e.status].variant}>{t(STATUS[e.status].label)}</Badge>
          </p>
          <p className="truncate text-xs text-muted-foreground">{summary(e, t)}</p>
        </div>
        {e.status === 'ready' && (
          <Button variant="outline" size="sm" loading={downloading} onClick={onDownload}>
            <Download aria-hidden /> {t('privacy.export.download')}
          </Button>
        )}
      </div>
      {inProgress(e) && (
        <Progress
          done={e.progress.done}
          total={e.progress.total}
          label={t('privacy.export.progress')}
        />
      )}
    </li>
  )
}

export function ExportCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: exports } = useSuspenseQuery(exportsQuery)
  const busy = exports.some(inProgress)

  const request = useMutation({
    mutationFn: requestExport,
    onSuccess: () => {
      toast.success(t('privacy.export.requestedToast'))
      void queryClient.invalidateQueries({ queryKey: exportsQuery.queryKey })
    },
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })
  const download = useMutation({
    mutationFn: exportDownloadUrl,
    // A navigation to the file, not a fetch: the browser saves it, and the link is only valid for a few minutes.
    onSuccess: (url) => window.location.assign(url),
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })

  return (
    <Card>
      {exports.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6" data-testid="no-exports">
          {t('privacy.export.none')}
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label={t('privacy.export.list')}>
          {exports.map((e) => (
            <ExportRow
              key={e.id}
              item={e}
              downloading={download.isPending && download.variables === e.id}
              onDownload={() => download.mutate(e.id)}
            />
          ))}
        </ul>
      )}
      <CardFooter>
        <p className="text-xs text-muted-foreground">{t('privacy.export.footer')}</p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          loading={request.isPending}
          onClick={() => request.mutate()}
        >
          {t('privacy.export.request')}
        </Button>
      </CardFooter>
    </Card>
  )
}
