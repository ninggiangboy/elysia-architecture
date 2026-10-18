import { Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { requestPasswordReset } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/password/forgot')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: requestPasswordReset,
    onSuccess: (_, address) => setSentTo(address),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate(email.trim())
  }

  return (
    <AuthShell>
      <Card>
        {sentTo ? (
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center" role="status">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <MailCheck className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-lg font-semibold tracking-tight">{t('forgot.sentTitle')}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Trans
                  i18nKey="forgot.sent"
                  values={{ email: sentTo }}
                  components={{ b: <span className="font-medium break-all text-foreground" /> }}
                />
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/login">{t('callback.backToSignIn')}</Link>
            </Button>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-semibold tracking-tight">{t('forgot.title')}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('forgot.intro')}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="forgot-email">{t('login.email')}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  inputMode="email"
                  placeholder={t('login.emailPlaceholder')}
                  className="sm:h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" loading={send.isPending}>
                {t('forgot.send')}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">{t('callback.backToSignIn')}</Link>
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </AuthShell>
  )
}
