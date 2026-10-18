import { Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Fingerprint, MailCheck } from 'lucide-react'
import { type FormEvent, type MouseEvent, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { CodeForm } from '@/features/auth/code-form'
import { MfaForm } from '@/features/auth/mfa-form'
import { type PendingSignIn, pendingFrom, pendingSignIn } from '@/features/auth/pending'
import { ProviderIcon, providerName } from '@/features/auth/provider-icons'
import {
  authOptionsQuery,
  loginWithPasskey,
  loginWithPassword,
  requestMagicLink,
  startOAuthLogin,
  verifyEmailCode,
} from '@/features/auth/queries'
import { SignupForm } from '@/features/auth/signup-form'
import { errorMessage } from '@/lib/api'
import { ensureSession } from '@/lib/session'
import { browserSupportsWebAuthn, passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/' })
  },
  // prefetchQuery never throws: without the options the page falls back to the email link alone.
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(authOptionsQuery),
  component: LoginPage,
})

type Phase =
  | { name: 'form' }
  | { name: 'sent'; email: string }
  | { name: 'mfa'; token: string }
  | { name: 'signup'; pending: Extract<PendingSignIn, { kind: 'signup' }> }

const phaseOf = (pending: PendingSignIn | null): Phase =>
  pending?.kind === 'mfa'
    ? { name: 'mfa', token: pending.token }
    : pending?.kind === 'signup'
      ? { name: 'signup', pending }
      : { name: 'form' }

const FALLBACK = {
  methods: ['email'],
  registration: 'open',
  providers: [] as string[],
  providerNames: {} as Record<string, string>,
}

function LoginPage() {
  const navigate = useNavigate()
  const { data } = useQuery(authOptionsQuery)
  const options = data ?? FALLBACK
  const [phase, setPhase] = useState<Phase>(() => phaseOf(pendingSignIn.peek()))
  // A callback page parked a half-finished sign-in here; it is ours now.
  useEffect(() => pendingSignIn.clear(), [])

  const home = () => navigate({ to: '/', replace: true })
  /** A first step answered: signed in, or something is still due. */
  const proceed = (outcome: Parameters<typeof pendingFrom>[0]) => {
    const pending = pendingFrom(outcome)
    if (pending) setPhase(phaseOf(pending))
    else void home()
  }
  const back = () => setPhase({ name: 'form' })

  return (
    <AuthShell>
      <Card>
        {phase.name === 'sent' ? (
          <SentPanel email={phase.email} onProceed={proceed} onBack={back} />
        ) : phase.name === 'mfa' ? (
          <MfaForm token={phase.token} onDone={() => void home()} onBack={back} />
        ) : phase.name === 'signup' ? (
          <SignupForm pending={phase.pending} onDone={() => void home()} onBack={back} />
        ) : (
          <CredentialsForm
            options={options}
            onLinkSent={(email) => setPhase({ name: 'sent', email })}
            onProceed={proceed}
          />
        )}
      </Card>
      {phase.name === 'form' && <Footer options={options} />}
    </AuthShell>
  )
}

function Footer({ options }: { options: typeof FALLBACK }) {
  const { t } = useTranslation()
  const passwords = options.methods.includes('password')
  const text =
    options.registration === 'closed'
      ? t('login.registrationClosed')
      : options.registration === 'invite'
        ? t('login.inviteOnly')
        : null
  return (
    <p className="mt-6 text-center text-xs text-muted-foreground">
      {text ??
        (passwords ? (
          <Trans
            i18nKey="login.createAccount"
            components={{
              a: (
                <Link
                  to="/register"
                  className="font-medium text-foreground underline underline-offset-2"
                />
              ),
            }}
          />
        ) : (
          t('login.newHere')
        ))}
    </p>
  )
}

function CredentialsForm({
  options,
  onLinkSent,
  onProceed,
}: {
  options: typeof FALLBACK
  onLinkSent: (email: string) => void
  onProceed: (outcome: Parameters<typeof pendingFrom>[0]) => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const withPassword = options.methods.includes('password')
  const withLink = options.methods.includes('email')
  const withPasskey = options.methods.includes('passkey') && browserSupportsWebAuthn()
  const providers = options.providers

  const link = useMutation({
    mutationFn: requestMagicLink,
    onSuccess: (_, sent) => onLinkSent(sent),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const signIn = useMutation({
    mutationFn: () => loginWithPassword(email.trim(), password),
    onSuccess: onProceed,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const passkey = useMutation({
    mutationFn: loginWithPasskey,
    onSuccess: onProceed,
    onError: (err) => {
      if (!passkeyCancelled(err)) toast.error(passkeyErrorMessage(err))
    },
  })
  const oauth = useMutation({
    mutationFn: startOAuthLogin,
    // Leaves the app: the provider sends the browser back to /auth/oauth/callback.
    onSuccess: (url) => window.location.assign(url),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const busy = link.isPending || signIn.isPending || passkey.isPending || oauth.isPending
  const showAlternatives = withPasskey || providers.length > 0
  const withEmailField = withPassword || withLink

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (withPassword) signIn.mutate()
    else link.mutate(email.trim())
  }
  /** "Email me a link instead" needs a valid address first. */
  const sendLink = (e: MouseEvent<HTMLButtonElement>) => {
    const field = e.currentTarget.form?.elements.namedItem('email')
    if (field instanceof HTMLInputElement && field.reportValidity()) link.mutate(email.trim())
  }

  return (
    <CardContent>
      {withEmailField && (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">{t('login.title')}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {withPassword ? t('login.introPassword') : t('login.intro')}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input
              id="email"
              name="email"
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
          {withPassword && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <Link
                  to="/password/forgot"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {t('login.forgot')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={256}
                className="sm:h-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            loading={withPassword ? signIn.isPending : link.isPending}
            disabled={busy}
          >
            {withPassword ? t('login.signIn') : t('login.send')}
          </Button>
          {withPassword && withLink && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              loading={link.isPending}
              disabled={busy}
              onClick={sendLink}
            >
              <MailCheck aria-hidden /> {t('login.send')}
            </Button>
          )}
        </form>
      )}
      {showAlternatives && (
        <div className={withEmailField ? 'mt-5 flex flex-col gap-3' : 'flex flex-col gap-3'}>
          {withEmailField && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              {t('login.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {withPasskey && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              loading={passkey.isPending}
              disabled={busy}
              onClick={() => passkey.mutate()}
            >
              <Fingerprint aria-hidden /> {t('login.passkey')}
            </Button>
          )}
          {providers.map((provider) => (
            <Button
              key={provider}
              type="button"
              variant="outline"
              size="lg"
              loading={oauth.isPending && oauth.variables === provider}
              disabled={busy}
              onClick={() => oauth.mutate(provider)}
            >
              <ProviderIcon provider={provider} className="size-4" />
              {t('login.continueWith', {
                provider: providerName(provider, options.providerNames),
              })}
            </Button>
          ))}
        </div>
      )}
    </CardContent>
  )
}

/** The link is on its way; its code can be typed here instead of opening it (on another device, say). */
function SentPanel({
  email,
  onProceed,
  onBack,
}: {
  email: string
  onProceed: (outcome: Parameters<typeof pendingFrom>[0]) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const resend = useMutation({
    mutationFn: requestMagicLink,
    onSuccess: () => toast.success(t('login.resent')),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const verify = useMutation({
    mutationFn: (code: string) => verifyEmailCode(email, code),
    onSuccess: onProceed,
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <CardContent className="flex flex-col items-center gap-5 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <MailCheck className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5" role="status">
        <h1 className="text-lg font-semibold tracking-tight">{t('login.sentTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Trans
            i18nKey="login.sent"
            values={{ email }}
            components={{ b: <span className="font-medium break-all text-foreground" /> }}
          />
        </p>
      </div>
      <div className="w-full text-left">
        <CodeForm
          id="email-code"
          label={t('login.codeLabel')}
          hint={t('login.codeHint')}
          submitLabel={t('login.codeSubmit')}
          pending={verify.isPending}
          onSubmit={(code) => verify.mutate(code)}
        />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden /> {t('login.differentEmail')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          loading={resend.isPending}
          onClick={() => resend.mutate(email)}
        >
          {t('login.resend')}
        </Button>
      </div>
    </CardContent>
  )
}
