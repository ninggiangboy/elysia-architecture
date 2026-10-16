import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Download, FileArchive } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'
import { Progress } from './progress'
import { type DataExport, exportDownloadUrl, exportsQuery, requestExport } from './queries'

const STATUS: Record<
  DataExport['status'],
  { label: string; variant: 'default' | 'success' | 'warning' }
> = {
  collecting: { label: 'Collecting', variant: 'default' },
  assembling: { label: 'Packing', variant: 'default' },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'warning' },
  expired: { label: 'Expired', variant: 'default' },
}

const inProgress = (e: DataExport) => e.status === 'collecting' || e.status === 'assembling'

/** The line under the date: what the user needs to know about this export right now. */
function summary(e: DataExport): string {
  switch (e.status) {
    case 'ready':
      return `${e.size ? `${formatBytes(e.size)} · ` : ''}available until ${e.expiresAt ? formatDate(e.expiresAt) : '—'}`
    case 'failed':
      return 'Something went wrong. You can request it again.'
    case 'expired':
      return 'The download is no longer available.'
    default:
      return `${e.progress.done} of ${e.progress.total} parts collected`
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
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:px-6" data-testid="export">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <FileArchive className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Requested {formatDate(e.requestedAt)}
            <Badge variant={STATUS[e.status].variant}>{STATUS[e.status].label}</Badge>
          </p>
          <p className="truncate text-xs text-muted-foreground">{summary(e)}</p>
        </div>
        {e.status === 'ready' && (
          <Button variant="outline" size="sm" loading={downloading} onClick={onDownload}>
            <Download aria-hidden /> Download
          </Button>
        )}
      </div>
      {inProgress(e) && (
        <Progress done={e.progress.done} total={e.progress.total} label="Export progress" />
      )}
    </li>
  )
}

export function ExportCard() {
  const queryClient = useQueryClient()
  const { data: exports } = useSuspenseQuery(exportsQuery)
  const busy = exports.some(inProgress)

  const request = useMutation({
    mutationFn: requestExport,
    onSuccess: () => {
      toast.success('Preparing your export. We will email you the link when it is ready.')
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
          You have not requested an export yet.
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Data exports">
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
        <p className="text-xs text-muted-foreground">
          A zip with what each part of the service holds about you. Asking for it, and downloading
          it, ask you to confirm it is you.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          loading={request.isPending}
          onClick={() => request.mutate()}
        >
          Request an export
        </Button>
      </CardFooter>
    </Card>
  )
}
