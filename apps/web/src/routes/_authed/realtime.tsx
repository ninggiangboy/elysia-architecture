import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendTestEvent } from '@/features/realtime/queries'
import { SsePanel } from '@/features/realtime/sse-panel'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/_authed/realtime')({
  component: RealtimePage,
})

const STEPS = [
  ['API', 'Your test event is written to the outbox.'],
  ['Postgres', 'The relay publishes it with LISTEN/NOTIFY.'],
  ['Every replica', 'Each API instance pushes it to the streams it holds.'],
] as const

function RealtimePage() {
  const [message, setMessage] = useState('hello')
  const send = useMutation({
    mutationFn: sendTestEvent,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate(message.trim())
  }

  return (
    <>
      <PageHeader
        title="Realtime"
        description="A live Server-Sent Events stream fanned out through Postgres — no Redis, works across any number of API replicas."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Send a test event</CardTitle>
            <CardDescription>It should show up in the event log within a moment.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Label htmlFor="test-message">Test message</Label>
              <div className="flex gap-2">
                <Input
                  id="test-message"
                  value={message}
                  maxLength={200}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button
                  type="submit"
                  disabled={!message.trim()}
                  loading={send.isPending}
                  aria-label="Send test event"
                  title="Send test event"
                >
                  {!send.isPending && <Send aria-hidden />}
                  <span className="hidden sm:inline">Send</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <SsePanel />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>How it travels</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <div className="text-sm">
                    <p className="font-medium">{title}</p>
                    <p className="text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              Tip: sign in on a second device, then sign it out from the Profile page to watch the
              session events arrive.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
