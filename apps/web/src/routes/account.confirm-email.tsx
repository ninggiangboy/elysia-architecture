import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { Button } from '@/components/ui/button'
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
  const { token } = Route.useSearch()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<{ email: string } | { error: string } | null>(
    token ? null : { error: 'Invalid link.' },
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
      <Link to="/">Back to home</Link>
    </Button>
  )

  return (
    <AuthShell>
      {!result ? (
        <StatusPanel tone="pending" title="Confirming…">
          Updating your account email.
        </StatusPanel>
      ) : 'error' in result ? (
        <StatusPanel tone="error" title="Could not confirm" action={home}>
          {result.error}
        </StatusPanel>
      ) : (
        <StatusPanel tone="success" title="Email changed" action={home}>
          Your account email is now{' '}
          <span className="font-medium break-all text-foreground">{result.email}</span>.
        </StatusPanel>
      )}
    </AuthShell>
  )
}
