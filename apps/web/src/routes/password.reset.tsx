import { Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { authOptionsQuery, resetPassword } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/password/reset')({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : undefined,
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const { data: options } = useQuery(authOptionsQuery)
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => resetPassword(token ?? '', password),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    reset.mutate()
  }
  const signIn = (
    <Button asChild variant="outline">
      <Link to="/login">{t('callback.backToSignIn')}</Link>
    </Button>
  )

  return (
    <AuthShell>
      {!token ? (
        <StatusPanel tone="error" title={t('reset.invalidTitle')} action={signIn}>
          {t('callback.invalidLink')}
        </StatusPanel>
      ) : reset.isSuccess ? (
        <StatusPanel tone="success" title={t('reset.doneTitle')} action={signIn}>
          {t('reset.done')}
        </StatusPanel>
      ) : (
        <Card>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-semibold tracking-tight">{t('reset.title')}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('reset.intro')}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reset-password">{t('reset.newPassword')}</Label>
                <Input
                  id="reset-password"
                  type="password"
                  required
                  autoFocus
                  autoComplete="new-password"
                  minLength={options?.passwordMinLength ?? 8}
                  maxLength={128}
                  className="sm:h-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" loading={reset.isPending}>
                {t('reset.save')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AuthShell>
  )
}
