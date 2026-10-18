import { Button, Dialog, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Fingerprint, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { type FormEvent, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { passkeysQuery, securityQuery } from '@/features/account/queries'
import { errorMessage } from '@/lib/api'
import { passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'
import { CodeForm } from './code-form'
import {
  confirmWithCode,
  confirmWithPasskey,
  confirmWithPassword,
  confirmWithTotp,
  sendConfirmationCode,
  stepUpDialog,
} from './step-up'

type Mode = 'choose' | 'code' | 'totp' | 'password'

/** Mount once in the signed-in layout. Shows up whenever a sensitive action asks the user to confirm it is them. */
export function StepUpHost() {
  const open = useSyncExternalStore(stepUpDialog.subscribe, stepUpDialog.isOpen)
  return open ? <StepUpDialog /> : null
}

const done = () => stepUpDialog.settle(true)
const failed = (err: unknown) => toast.error(errorMessage(err))

function StepUpDialog() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('choose')
  // Each view reports whether it is waiting on the server, so the dialog cannot be closed halfway.
  const [busy, setBusy] = useState(false)

  return (
    <Dialog title={t('stepUp.title')} busy={busy} onClose={() => stepUpDialog.settle(false)}>
      {mode === 'choose' && <ChooseMethod onMode={setMode} onBusy={setBusy} />}
      {mode === 'code' && <EmailCodeView onBack={() => setMode('choose')} onBusy={setBusy} />}
      {mode === 'totp' && <TotpView onBack={() => setMode('choose')} onBusy={setBusy} />}
      {mode === 'password' && <PasswordView onBack={() => setMode('choose')} onBusy={setBusy} />}
      {!busy && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => stepUpDialog.settle(false)}
        >
          {t('common.cancel')}
        </Button>
      )}
    </Dialog>
  )
}

/** Only the ways this account actually has are offered; the emailed code is always there. */
function ChooseMethod({
  onMode,
  onBusy,
}: {
  onMode: (mode: Mode) => void
  onBusy: (b: boolean) => void
}) {
  const { t } = useTranslation()
  const { data: passkeys } = useQuery(passkeysQuery)
  const { data: security } = useQuery(securityQuery)
  const hasPasskey = (passkeys?.length ?? 0) > 0
  const hasTotp = security?.twoFactor.enabled ?? false
  const hasPassword = security?.hasPassword ?? false

  const usePasskey = useMutation({
    mutationFn: confirmWithPasskey,
    onSuccess: done,
    onError: (err) => {
      if (!passkeyCancelled(err)) toast.error(passkeyErrorMessage(err))
    },
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
  })
  const sendCode = useMutation({
    mutationFn: sendConfirmationCode,
    onSuccess: () => onMode('code'),
    onError: failed,
  })
  const busy = usePasskey.isPending || sendCode.isPending
  // The first way offered is the primary button.
  const emailIsPrimary = !hasPasskey && !hasTotp && !hasPassword

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('stepUp.intro')}</p>
      <div className="flex flex-col gap-2">
        {hasPasskey && (
          <Button
            loading={usePasskey.isPending}
            disabled={busy}
            onClick={() => usePasskey.mutate()}
          >
            <Fingerprint aria-hidden /> {t('stepUp.passkey')}
          </Button>
        )}
        {hasTotp && (
          <Button
            variant={hasPasskey ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => onMode('totp')}
          >
            <ShieldCheck aria-hidden /> {t('stepUp.authenticator')}
          </Button>
        )}
        {hasPassword && (
          <Button
            variant={hasPasskey || hasTotp ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => onMode('password')}
          >
            <KeyRound aria-hidden /> {t('stepUp.password')}
          </Button>
        )}
        <Button
          variant={emailIsPrimary ? 'default' : 'outline'}
          loading={sendCode.isPending}
          disabled={busy}
          onClick={() => sendCode.mutate()}
        >
          <Mail aria-hidden /> {t('stepUp.emailCode')}
        </Button>
      </div>
    </div>
  )
}

function EmailCodeView({ onBack, onBusy }: { onBack: () => void; onBusy: (b: boolean) => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const sendCode = useMutation({ mutationFn: sendConfirmationCode, onError: failed })
  const verify = useMutation({
    mutationFn: confirmWithCode,
    onSuccess: done,
    onError: failed,
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(code.trim())
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('stepUp.sentCode')}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="step-up-code">{t('stepUp.code')}</Label>
        <Input
          id="step-up-code"
          autoFocus
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123456"
          className="tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={sendCode.isPending}
          disabled={verify.isPending}
          onClick={() => sendCode.mutate()}
        >
          {t('stepUp.sendNew')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={verify.isPending}
            disabled={code.trim().length < 6}
          >
            {t('stepUp.confirm')}
          </Button>
        </div>
      </div>
    </form>
  )
}

function TotpView({ onBack, onBusy }: { onBack: () => void; onBusy: (b: boolean) => void }) {
  const { t } = useTranslation()
  const verify = useMutation({
    mutationFn: confirmWithTotp,
    onSuccess: done,
    onError: failed,
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
  })
  return (
    <CodeForm
      id="step-up-totp"
      label={t('stepUp.authenticatorCode')}
      submitLabel={t('stepUp.confirm')}
      pending={verify.isPending}
      onSubmit={(code) => verify.mutate(code)}
    >
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        {t('common.back')}
      </Button>
    </CodeForm>
  )
}

function PasswordView({ onBack, onBusy }: { onBack: () => void; onBusy: (b: boolean) => void }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const verify = useMutation({
    mutationFn: confirmWithPassword,
    onSuccess: done,
    onError: failed,
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(password)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="step-up-password">{t('stepUp.passwordLabel')}</Label>
        <Input
          id="step-up-password"
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button type="submit" size="sm" loading={verify.isPending}>
          {t('stepUp.confirm')}
        </Button>
      </div>
    </form>
  )
}
