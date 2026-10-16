import { useMutation, useQuery } from '@tanstack/react-query'
import { Fingerprint, Mail } from 'lucide-react'
import { type FormEvent, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { passkeysQuery } from '@/features/account/queries'
import { errorMessage } from '@/lib/api'
import { passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'
import { confirmWithCode, confirmWithPasskey, sendConfirmationCode, stepUpDialog } from './step-up'

/** Mount once in the signed-in layout. Shows up whenever a sensitive action asks the user to confirm it is them. */
export function StepUpHost() {
  const open = useSyncExternalStore(stepUpDialog.subscribe, stepUpDialog.isOpen)
  return open ? <StepUpDialog /> : null
}

function StepUpDialog() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'choose' | 'code'>('choose')
  const [code, setCode] = useState('')
  const { data: passkeys } = useQuery(passkeysQuery)
  const hasPasskey = (passkeys?.length ?? 0) > 0

  const done = () => stepUpDialog.settle(true)
  const usePasskey = useMutation({
    mutationFn: confirmWithPasskey,
    onSuccess: done,
    onError: (err) => {
      if (!passkeyCancelled(err)) toast.error(passkeyErrorMessage(err))
    },
  })
  const sendCode = useMutation({
    mutationFn: sendConfirmationCode,
    onSuccess: () => setMode('code'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const verify = useMutation({
    mutationFn: confirmWithCode,
    onSuccess: done,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const busy = usePasskey.isPending || sendCode.isPending || verify.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(code.trim())
  }

  return (
    <Dialog title={t('stepUp.title')} busy={busy} onClose={() => stepUpDialog.settle(false)}>
      {mode === 'choose' ? (
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
            <Button
              variant={hasPasskey ? 'outline' : 'default'}
              loading={sendCode.isPending}
              disabled={busy}
              onClick={() => sendCode.mutate()}
            >
              <Mail aria-hidden /> {t('stepUp.emailCode')}
            </Button>
          </div>
        </div>
      ) : (
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
              disabled={busy}
              onClick={() => sendCode.mutate()}
            >
              {t('stepUp.sendNew')}
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
        </form>
      )}
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
