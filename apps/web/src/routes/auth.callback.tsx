import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { Button } from '@/components/ui/button'
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
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(token ? null : 'Invalid link.')

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
          title="Could not sign in"
          action={
            <Button asChild variant="outline">
              <Link to="/login">Request a new link</Link>
            </Button>
          }
        >
          {error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="pending" title="Signing you in…">
          Verifying your sign-in link.
        </StatusPanel>
      )}
    </AuthShell>
  )
}
