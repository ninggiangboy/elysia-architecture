import { Button } from '@kit/ui'
import { once } from '@kit/web-core'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { verifySignupToken } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/register_/verify')({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : undefined,
  }),
  component: VerifySignupPage,
})

function VerifySignupPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(token ? null : t('callback.invalidLink'))

  useEffect(() => {
    if (!token) return
    // The link is one-time: `once` stops StrictMode's second mount from spending it twice.
    once(`signup:${token}`, () => verifySignupToken(token))
      .then(() => navigate({ to: '/', replace: true }))
      .catch((err) => setError(errorMessage(err)))
  }, [token, navigate])

  return (
    <AuthShell>
      {error ? (
        <StatusPanel
          tone="error"
          title={t('register.verifyFailed')}
          action={
            <Button asChild variant="outline">
              <Link to="/register">{t('register.startOver')}</Link>
            </Button>
          }
        >
          {error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="pending" title={t('register.verifying')}>
          {t('register.verifyingBody')}
        </StatusPanel>
      )}
    </AuthShell>
  )
}
