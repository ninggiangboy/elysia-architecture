import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { connectSse, type RealtimeMessage, type RealtimeStatus } from '@/lib/realtime'

interface LogEntry {
  key: number
  at: string
  message: RealtimeMessage
}

const MAX_LOG = 30

/** The live SSE connection with its status and the events it received. Mount = connect, unmount = disconnect. */
export function SsePanel() {
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
          [{ key: ++counter.current, at: new Date().toLocaleTimeString(), message }, ...prev].slice(
            0,
            MAX_LOG,
          ),
        ),
    })
    return () => connection.close()
  }, [enabled])

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Server-Sent Events</CardTitle>
          <CardDescription>
            One-way stream over HTTP (fetch + Authorization header). Reconnects by itself.
          </CardDescription>
        </div>
        <span
          data-testid="status-sse"
          className="shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium"
        >
          {status}
        </span>
      </div>
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={() => setEnabled((v) => !v)}>
          {enabled ? 'Disconnect' : 'Connect'}
        </Button>
      </div>
      <ul
        className="mt-4 flex max-h-64 flex-col gap-1 overflow-auto font-mono text-xs"
        data-testid="log-sse"
      >
        {log.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
        {log.map((entry) => (
          <li key={entry.key} className="break-all">
            <span className="text-muted-foreground">{entry.at}</span>{' '}
            <strong>{entry.message.type}</strong>{' '}
            {entry.message.data ? JSON.stringify(entry.message.data) : ''}
          </li>
        ))}
      </ul>
    </Card>
  )
}
