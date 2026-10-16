import { Plug, Trash2, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { currentLocale } from '@/i18n'
import { connectSse, type RealtimeMessage, type RealtimeStatus } from '@/lib/realtime'
import { cn } from '@/lib/utils'

interface LogEntry {
  key: number
  at: string
  message: RealtimeMessage
}

const MAX_LOG = 30

const STATUS_STYLES: Record<RealtimeStatus, { badge: string; dot: string }> = {
  open: { badge: 'bg-success/12 text-success', dot: 'bg-success animate-pulse' },
  connecting: { badge: 'bg-warning/12 text-warning', dot: 'bg-warning' },
  reconnecting: { badge: 'bg-warning/12 text-warning', dot: 'bg-warning' },
  closed: { badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
}

/** The live SSE connection with its status and the events it received. Mount = connect, unmount = disconnect. */
export function SsePanel() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<RealtimeStatus>('closed')
  const [log, setLog] = useState<LogEntry[]>([])
  const [enabled, setEnabled] = useState(true)
  const counter = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const connection = connectSse({
      onStatus: setStatus,
      onMessage: (message) =>
        setLog((prev) =>
          [
            { key: ++counter.current, at: new Date().toLocaleTimeString(currentLocale()), message },
            ...prev,
          ].slice(0, MAX_LOG),
        ),
    })
    return () => connection.close()
  }, [enabled])

  const style = STATUS_STYLES[status]
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <CardTitle>{t('realtime.log')}</CardTitle>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                style.badge,
              )}
            >
              <span aria-hidden className={cn('size-1.5 rounded-full', style.dot)} />
              <span data-testid="status-sse">{t(`realtime.status.${status}`)}</span>
            </span>
          </div>
          <CardDescription>{t('realtime.logDescription')}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={log.length === 0}
            onClick={() => setLog([])}
            aria-label={t('realtime.clear')}
            title={t('realtime.clear')}
          >
            <Trash2 aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEnabled((v) => !v)}>
            {enabled ? <Unplug aria-hidden /> : <Plug aria-hidden />}
            {enabled ? t('realtime.disconnect') : t('realtime.connect')}
          </Button>
        </div>
      </div>
      <ul
        className="mx-5 mb-5 flex h-80 flex-col overflow-y-auto rounded-lg border border-border bg-muted/40 p-2 font-mono text-xs sm:mx-6 sm:mb-6 lg:h-[26rem]"
        data-testid="log-sse"
        aria-live="polite"
      >
        {log.length === 0 && (
          <li className="m-auto px-4 text-center font-sans text-sm text-muted-foreground">
            {t('realtime.noEvents')}
          </li>
        )}
        {log.map((entry) => (
          <li
            key={entry.key}
            className="flex flex-col gap-1 rounded-md px-2.5 py-2 hover:bg-card sm:flex-row sm:gap-3"
          >
            <span className="shrink-0 text-muted-foreground tabular-nums">{entry.at}</span>
            <div className="min-w-0">
              <span className="font-semibold text-accent-foreground">{entry.message.type}</span>
              {entry.message.data && (
                <pre className="mt-1 break-all whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(entry.message.data)}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
