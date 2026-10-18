import { Button } from '@kit/ui'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { verifyMagicLink } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'
import { once } from '@/lib/once'

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : undefined,
  }),
  component: CallbackPage,
})

function CallbackPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(token ? null : t('callback.invalidLink'))

  useEffect(() => {
    if (!token) return
    // A magic link is one-time: `once` prevents a double call when StrictMode remounts the effect.
    once(`magic:${token}`, () => verifyMagicLink(token))
      .then(() => navigate({ to: '/', replace: true }))
      .catch((err) => setError(errorMessage(err)))
  }, [token, navigate])

  return (
    <AuthShell>
      {error ? (
        <StatusPanel
          tone="error"
          title={t('callback.couldNotSignIn')}
          action={
            <Button asChild variant="outline">
              <Link to="/login">{t('callback.requestNewLink')}</Link>
            </Button>
          }
        >
          {error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="pending" title={t('callback.signingIn')}>
          {t('callback.verifying')}
        </StatusPanel>
      )}
    </AuthShell>
  )
}
