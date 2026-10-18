import { Badge, Button, Card, CardFooter, Dialog } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CodeForm } from '@/features/auth/code-form'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import {
  beginTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  newRecoveryCodes,
  securityQuery,
} from './queries'

type Step =
  | { name: 'idle' }
  | { name: 'scan'; secret: string; uri: string }
  | { name: 'codes'; codes: string[] }

/** An inline SVG QR code: the secret never leaves the page. */
function Qr({ value }: { value: string }) {
  const { t } = useTranslation()
  const svg = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()
    return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [value])
  return (
    <div
      role="img"
      aria-label={t('twoFactor.qrLabel')}
      className="mx-auto size-44 rounded-lg bg-white p-1 [&_svg]:size-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the SVG is generated locally from the otpauth URI
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Authenticator app: turn on (scan, confirm a code, keep the recovery codes), new recovery codes, turn off. */
export function TwoFactorCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: security } = useSuspenseQuery(securityQuery)
  const status = security.twoFactor
  const [step, setStep] = useState<Step>({ name: 'idle' })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: securityQuery.queryKey })
  const quietly = (err: unknown) => {
    if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
  }

  const begin = useMutation({
    mutationFn: beginTwoFactor,
    onSuccess: (setup) => setStep({ name: 'scan', ...setup }),
    onError: quietly,
  })
  const enable = useMutation({
    mutationFn: enableTwoFactor,
    onSuccess: (result) => {
      toast.success(t('twoFactor.enabledToast'))
      setStep({ name: 'codes', codes: result.recoveryCodes })
      refresh()
    },
    onError: quietly,
  })
  const regenerate = useMutation({
    mutationFn: newRecoveryCodes,
    onSuccess: (result) => {
      setStep({ name: 'codes', codes: result.recoveryCodes })
      refresh()
    },
    onError: quietly,
  })
  const disable = useMutation({
    mutationFn: disableTwoFactor,
    onSuccess: () => {
      toast.success(t('twoFactor.disabledToast'))
      refresh()
    },
    onError: quietly,
  })

  if (!status.available) return null

  return (
    <Card>
      <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t('twoFactor.app')}
            <Badge variant={status.enabled ? 'default' : 'outline'}>
              {status.enabled ? t('twoFactor.on') : t('twoFactor.off')}
            </Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {status.enabled
              ? t('twoFactor.recoveryLeft', { count: status.recoveryCodesRemaining })
              : t('twoFactor.hint')}
          </p>
        </div>
      </div>
      <CardFooter>
        <p className="text-xs text-muted-foreground">{t('twoFactor.scope')}</p>
        <div className="ml-auto flex gap-2">
          {status.enabled ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                loading={regenerate.isPending}
                onClick={() => regenerate.mutate()}
              >
                {t('twoFactor.newCodes')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={disable.isPending}
                onClick={() => disable.mutate()}
              >
                {t('twoFactor.turnOff')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              loading={begin.isPending}
              onClick={() => begin.mutate()}
            >
              {t('twoFactor.turnOn')}
            </Button>
          )}
        </div>
      </CardFooter>

      {step.name === 'scan' && (
        <Dialog
          title={t('twoFactor.setupTitle')}
          busy={enable.isPending}
          onClose={() => setStep({ name: 'idle' })}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{t('twoFactor.scan')}</p>
            <Qr value={step.uri} />
            <p className="text-center text-xs text-muted-foreground">
              {t('twoFactor.orType')}{' '}
              <code className="font-mono break-all text-foreground" data-testid="totp-secret">
                {step.secret}
              </code>
            </p>
            <CodeForm
              id="totp-enable"
              label={t('twoFactor.confirmCode')}
              submitLabel={t('twoFactor.confirm')}
              pending={enable.isPending}
              onSubmit={(code) => enable.mutate(code)}
            />
          </div>
        </Dialog>
      )}

      {step.name === 'codes' && (
        <Dialog title={t('twoFactor.codesTitle')} onClose={() => setStep({ name: 'idle' })}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('twoFactor.codesBody')}
            </p>
            <ul
              className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm"
              data-testid="recovery-codes"
            >
              {step.codes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(step.codes.join('\n'))
                  toast.success(t('twoFactor.copied'))
                }}
              >
                {t('twoFactor.copy')}
              </Button>
              <Button size="sm" onClick={() => setStep({ name: 'idle' })}>
                {t('twoFactor.saved')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
