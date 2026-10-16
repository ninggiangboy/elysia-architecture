import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { Button } from '@/components/ui/button'
import { connectedAccountsQuery } from '@/features/account/queries'
import { providerName } from '@/features/auth/provider-icons'
import { completeOAuth } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'
import { once } from '@/lib/once'
import { ensureSession } from '@/lib/session'

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export const Route = createFileRoute('/auth/oauth/callback')({
  validateSearch: (s: Record<string, unknown>) => ({
    code: str(s.code),
    state: str(s.state),
    error: str(s.error),
  }),
  component: OAuthCallbackPage,
})

function OAuthCallbackPage() {
  const { code, state, error: providerError } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const failure = providerError
    ? 'The sign-in was cancelled or denied.'
    : !code || !state
      ? 'Invalid link.'
      : null
  const [error, setError] = useState<string | null>(failure)

  useEffect(() => {
    if (failure || !code || !state) return
    // The code is single use: `once` stops StrictMode's second mount from spending it twice.
    once(`oauth:${state}`, async () => {
      // Coming back from the provider is a full page load, so the in-memory access token is gone. Connecting an
      // account must be finished by the signed-in user who started it, so restore the session first.
      await ensureSession()
      return completeOAuth(code, state)
    })
      .then(async (result) => {
        if (result.purpose === 'login') {
          await navigate({ to: '/', replace: true })
          return
        }
        toast.success(`${providerName(result.provider)} connected`)
        await queryClient.invalidateQueries({ queryKey: connectedAccountsQuery.queryKey })
        await navigate({ to: '/security', replace: true })
      })
      .catch((err) => setError(errorMessage(err)))
  }, [failure, code, state, navigate, queryClient])

  return (
    <AuthShell>
      {error ? (
        <StatusPanel
          tone="error"
          title="Could not sign in"
          action={
            <Button asChild variant="outline">
              <Link to="/login">Back to sign in</Link>
            </Button>
          }
        >
          {error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="pending" title="Signing you in…">
          Finishing with your account provider.
        </StatusPanel>
      )}
    </AuthShell>
  )
}
