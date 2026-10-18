import { Button } from '@kit/ui'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { confirmEmailChange } from '@/features/account/queries'
import { errorMessage } from '@/lib/api'
import { once } from '@/lib/once'

export const Route = createFileRoute('/account/confirm-email')({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : undefined,
  }),
  component: ConfirmEmailPage,
})

function ConfirmEmailPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<{ email: string } | { error: string } | null>(
    token ? null : { error: t('callback.invalidLink') },
  )

  useEffect(() => {
    if (!token) return
    once(`email-change:${token}`, () => confirmEmailChange(token))
      .then((data) => {
        setResult({ email: data.email })
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      })
      .catch((err) => setResult({ error: errorMessage(err) }))
  }, [token, queryClient])

  const home = (
    <Button asChild variant="outline">
      <Link to="/">{t('common.backToHome')}</Link>
    </Button>
  )

  return (
    <AuthShell>
      {!result ? (
        <StatusPanel tone="pending" title={t('confirmEmail.confirming')}>
          {t('confirmEmail.updating')}
        </StatusPanel>
      ) : 'error' in result ? (
        <StatusPanel tone="error" title={t('confirmEmail.failed')} action={home}>
          {result.error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="success" title={t('confirmEmail.changedTitle')} action={home}>
          <Trans
            i18nKey="confirmEmail.changed"
            values={{ email: result.email }}
            components={{ b: <span className="font-medium break-all text-foreground" /> }}
          />
        </StatusPanel>
      )}
    </AuthShell>
  )
}
