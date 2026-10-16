import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { sendTestEvent } from '@/features/realtime/queries'
import { SsePanel } from '@/features/realtime/sse-panel'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/_authed/realtime')({
  component: RealtimePage,
})

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
      <Card>
        <CardTitle>Realtime check</CardTitle>
        <CardDescription>
          The stream below is open. A test event goes through the API and Postgres LISTEN/NOTIFY, so
          it reaches the stream even when it is held by a different API replica. Sign in on a second
          device and sign it out from the profile page to see the session events.
        </CardDescription>
        <form onSubmit={submit} className="mt-4 flex gap-2">
          <Input
            aria-label="Test message"
            value={message}
            maxLength={200}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" disabled={send.isPending || !message.trim()}>
            Send test event
          </Button>
        </form>
      </Card>
      <SsePanel />
    </>
  )
}
