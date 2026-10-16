import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestMagicLink } from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'
import { ensureSession } from '@/lib/session'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: requestMagicLink,
    onSuccess: (_, sent) => setSentTo(sent),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate(email.trim())
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        {sentTo ? (
          <div className="flex flex-col items-center gap-3 text-center" role="status">
            <MailCheck className="size-10 text-muted-foreground" aria-hidden />
            <CardTitle>Kiểm tra hộp thư của bạn</CardTitle>
            <CardDescription>
              Chúng tôi đã gửi liên kết đăng nhập tới <b className="text-foreground">{sentTo}</b>.
              Liên kết có hiệu lực 15 phút.
            </CardDescription>
            <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
              Dùng email khác
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <CardTitle className="text-xl">Đăng nhập</CardTitle>
              <CardDescription>
                Nhập email, chúng tôi sẽ gửi liên kết đăng nhập — không cần mật khẩu.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="ban@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Đang gửi…' : 'Gửi liên kết đăng nhập'}
            </Button>
          </form>
        )}
      </Card>
    </main>
  )
}
