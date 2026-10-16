import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
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
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm text-center" role="status">
        {error ? (
          <>
            <CardTitle>Could not sign in</CardTitle>
            <CardDescription>{error}</CardDescription>
            <Link to="/login" className="mt-4 inline-block text-sm underline">
              Request a new link
            </Link>
          </>
        ) : (
          <CardDescription>Signing in…</CardDescription>
        )}
      </Card>
    </main>
  )
}
