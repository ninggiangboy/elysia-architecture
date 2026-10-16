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
  const [error, setError] = useState<string | null>(token ? null : 'Liên kết không hợp lệ.')

  useEffect(() => {
    if (!token) return
    // Magic link dùng một lần: `once` chặn gọi hai lần khi StrictMode mount lại effect.
    once(`magic:${token}`, () => verifyMagicLink(token))
      .then(() => navigate({ to: '/', replace: true }))
      .catch((err) => setError(errorMessage(err)))
  }, [token, navigate])

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm text-center" role="status">
        {error ? (
          <>
            <CardTitle>Không thể đăng nhập</CardTitle>
            <CardDescription>{error}</CardDescription>
            <Link to="/login" className="mt-4 inline-block text-sm underline">
              Yêu cầu liên kết mới
            </Link>
          </>
        ) : (
          <CardDescription>Đang đăng nhập…</CardDescription>
        )}
      </Card>
    </main>
  )
}
