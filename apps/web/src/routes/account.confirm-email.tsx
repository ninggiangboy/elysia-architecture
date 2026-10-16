import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
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
    token ? null : { error: 'Liên kết không hợp lệ.' },
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

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm text-center" role="status">
        {!result ? (
          <CardDescription>Đang xác nhận…</CardDescription>
        ) : 'error' in result ? (
          <>
            <CardTitle>Không thể xác nhận</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </>
        ) : (
          <>
            <CardTitle>Đã đổi email</CardTitle>
            <CardDescription>
              Email tài khoản của bạn giờ là <b className="text-foreground">{result.email}</b>.
            </CardDescription>
          </>
        )}
        <Link to="/" className="mt-4 inline-block text-sm underline">
          Về trang chủ
        </Link>
      </Card>
    </main>
  )
}
