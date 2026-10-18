import { Button, CardContent } from '@kit/ui'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { CodeForm } from './code-form'
import { verifyMfa } from './queries'

/** Second step of a sign-in: the code from the authenticator app, or a recovery code. */
export function MfaForm({
  token,
  onDone,
  onBack,
}: {
  token: string
  onDone: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [recovery, setRecovery] = useState(false)
  const verify = useMutation({
    mutationFn: (code: string) => verifyMfa(token, code),
    onSuccess: onDone,
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <CardContent className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{t('mfa.title')}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {recovery ? t('mfa.recoveryIntro') : t('mfa.intro')}
          </p>
        </div>
      </div>
      <CodeForm
        key={recovery ? 'recovery' : 'totp'}
        id="mfa-code"
        label={recovery ? t('mfa.recoveryCode') : t('mfa.code')}
        submitLabel={t('mfa.verify')}
        pending={verify.isPending}
        numeric={!recovery}
        onSubmit={(code) => verify.mutate(code)}
      >
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden /> {t('mfa.back')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRecovery(!recovery)}>
            {recovery ? t('mfa.useApp') : t('mfa.useRecovery')}
          </Button>
        </div>
      </CodeForm>
    </CardContent>
  )
}
