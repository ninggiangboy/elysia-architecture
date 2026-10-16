import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <AuthShell>
      <Card>
        {sentTo ? (
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center" role="status">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <MailCheck className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-lg font-semibold tracking-tight">Check your inbox</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                We sent a sign-in link to{' '}
                <span className="font-medium break-all text-foreground">{sentTo}</span>. It is valid
                for 15 minutes.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
                <ArrowLeft aria-hidden /> Use a different email
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={send.isPending}
                onClick={() => send.mutate(sentTo)}
              >
                Resend link
              </Button>
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Enter your email and we will send you a sign-in link — no password needed.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  className="h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" loading={send.isPending}>
                Send sign-in link
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        New here? The same link creates your account.
      </p>
    </AuthShell>
  )
}
