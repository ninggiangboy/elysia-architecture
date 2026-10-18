import { Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { StatusPanel } from '@/components/layout/status-panel'
import { CodeForm } from '@/features/auth/code-form'
import { authOptionsQuery, registerWithPassword, verifySignupCode } from '@/features/auth/queries'
import { TermsField } from '@/features/auth/terms-field'
import { errorMessage } from '@/lib/api'
import { ensureSession } from '@/lib/session'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/' })
  },
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(authOptionsQuery),
  component: RegisterPage,
})

function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: options } = useQuery(authOptionsQuery)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const minLength = options?.passwordMinLength ?? 8
  const termsVersion = options?.termsVersion ?? null
  const create = useMutation({
    mutationFn: () =>
      registerWithPassword({
        email: email.trim(),
        password,
        displayName: name.trim() || undefined,
        acceptTerms: termsVersion ? accepted : undefined,
      }),
    onSuccess: () => setSentTo(email.trim()),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const verify = useMutation({
    mutationFn: (code: string) => verifySignupCode(sentTo ?? '', code),
    onSuccess: () => navigate({ to: '/', replace: true }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  // Where this deployment does not take password sign-ups (or any new accounts), say so instead of showing a form.
  if (options && (!options.methods.includes('password') || options.registration === 'closed')) {
    return (
      <AuthShell>
        <StatusPanel
          tone="error"
          title={t('register.unavailableTitle')}
          action={
            <Button asChild variant="outline">
              <Link to="/login">{t('register.toSignIn')}</Link>
            </Button>
          }
        >
          {options.registration === 'closed' ? t('register.closed') : t('register.passwordsOff')}
        </StatusPanel>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <Card>
        {sentTo ? (
          <CardContent className="flex flex-col items-center gap-5 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <MailCheck className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-1.5" role="status">
              <h1 className="text-lg font-semibold tracking-tight">{t('register.sentTitle')}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Trans
                  i18nKey="register.sent"
                  values={{ email: sentTo }}
                  components={{ b: <span className="font-medium break-all text-foreground" /> }}
                />
              </p>
            </div>
            <div className="w-full text-left">
              <CodeForm
                id="signup-code"
                label={t('login.codeLabel')}
                hint={t('register.codeHint')}
                submitLabel={t('register.verify')}
                pending={verify.isPending}
                onSubmit={(code) => verify.mutate(code)}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
              <ArrowLeft aria-hidden /> {t('register.startOver')}
            </Button>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-semibold tracking-tight">{t('register.title')}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {options?.registration === 'invite'
                    ? t('register.inviteOnly')
                    : t('register.intro')}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-email">{t('login.email')}</Label>
                <Input
                  id="reg-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  inputMode="email"
                  placeholder={t('login.emailPlaceholder')}
                  className="sm:h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-name">{t('register.name')}</Label>
                <Input
                  id="reg-name"
                  autoComplete="name"
                  maxLength={50}
                  className="sm:h-10"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reg-password">{t('login.password')}</Label>
                <Input
                  id="reg-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={minLength}
                  maxLength={128}
                  className="sm:h-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('register.passwordHint', { count: minLength })}
                </p>
              </div>
              {termsVersion && (
                <TermsField
                  id="reg-terms"
                  checked={accepted}
                  onChange={setAccepted}
                  url={options?.termsUrl ?? null}
                />
              )}
              <Button
                type="submit"
                size="lg"
                loading={create.isPending}
                disabled={Boolean(termsVersion) && !accepted}
              >
                {t('register.create')}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Trans
          i18nKey="register.haveAccount"
          components={{
            a: (
              <Link
                to="/login"
                className="font-medium text-foreground underline underline-offset-2"
              />
            ),
          }}
        />
      </p>
    </AuthShell>
  )
}
