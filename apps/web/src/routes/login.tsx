import { Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Fingerprint, MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { ProviderIcon, providerName } from '@/features/auth/provider-icons'
import {
  loginWithPasskey,
  oauthProvidersQuery,
  requestMagicLink,
  startOAuthLogin,
} from '@/features/auth/queries'
import { errorMessage } from '@/lib/api'
import { ensureSession } from '@/lib/session'
import { browserSupportsWebAuthn, passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/' })
  },
  // prefetchQuery never throws: without the providers the page simply shows no provider buttons.
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(oauthProvidersQuery),
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: requestMagicLink,
    onSuccess: (_, sent) => setSentTo(sent),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const navigate = useNavigate()
  const { data: providers = [] } = useQuery(oauthProvidersQuery)
  const passkey = useMutation({
    mutationFn: loginWithPasskey,
    onSuccess: () => navigate({ to: '/', replace: true }),
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
  const busy = send.isPending || passkey.isPending || oauth.isPending
  const showAlternatives = browserSupportsWebAuthn() || providers.length > 0

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
              <h1 className="text-lg font-semibold tracking-tight">{t('login.sentTitle')}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Trans
                  i18nKey="login.sent"
                  values={{ email: sentTo }}
                  components={{ b: <span className="font-medium break-all text-foreground" /> }}
                />
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
                <ArrowLeft aria-hidden /> {t('login.differentEmail')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={send.isPending}
                onClick={() => send.mutate(sentTo)}
              >
                {t('login.resend')}
              </Button>
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-semibold tracking-tight">{t('login.title')}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('login.intro')}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t('login.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t('login.emailPlaceholder')}
                  className="sm:h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" loading={send.isPending} disabled={busy}>
                {t('login.send')}
              </Button>
            </form>
            {showAlternatives && (
              <div className="mt-5 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
                  <span className="h-px flex-1 bg-border" />
                  {t('login.or')}
                  <span className="h-px flex-1 bg-border" />
                </div>
                {browserSupportsWebAuthn() && (
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
                    {t('login.continueWith', { provider: providerName(provider) })}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
      <p className="mt-6 text-center text-xs text-muted-foreground">{t('login.newHere')}</p>
    </AuthShell>
  )
}
