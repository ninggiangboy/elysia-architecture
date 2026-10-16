import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  ['realtime.stepApi', 'realtime.stepApiText'],
  ['realtime.stepPostgres', 'realtime.stepPostgresText'],
  ['realtime.stepReplicas', 'realtime.stepReplicasText'],
] as const

function RealtimePage() {
  const { t } = useTranslation()
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
      <PageHeader title={t('realtime.title')} description={t('realtime.description')} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('realtime.sendTitle')}</CardTitle>
            <CardDescription>{t('realtime.sendDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Label htmlFor="test-message">{t('realtime.message')}</Label>
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
                  aria-label={t('realtime.sendLabel')}
                  title={t('realtime.sendLabel')}
                >
                  {!send.isPending && <Send aria-hidden />}
                  <span className="hidden sm:inline">{t('realtime.send')}</span>
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
            <CardTitle>{t('realtime.howTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <div className="text-sm">
                    <p className="font-medium">{t(title)}</p>
                    <p className="text-muted-foreground">{t(text)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              {t('realtime.tip')}
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
