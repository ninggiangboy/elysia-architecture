import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import {
  cardDigits,
  cvcLength,
  formatCardNumber,
  formatExpiry,
  isCardNumberValid,
  isCvcValid,
  parseExpiry,
} from '@/lib/card'
import { formatMoney } from '@/lib/format'
import { currencyDigits, parseMoney } from '@/lib/money'
import { confirmCardPayment } from '@/lib/stripe'
import { cn } from '@/lib/utils'
import { billingConfigQuery, createTopUp } from './queries'

interface Started {
  topUpId: string
  clientSecret: string
  currency: string
  amount: number
}

/** Step two: our own card form, paid straight to Stripe for the amount chosen in step one. */
function PaymentStep({
  started,
  publishableKey,
  onBack,
}: {
  started: Started
  publishableKey: string
  onBack: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exp = parseExpiry(expiry)
  const problems = {
    name: name.trim() === '',
    number: !isCardNumberValid(number),
    expiry: exp === null,
    cvc: !isCvcValid(cvc, number),
  }
  const invalid = (field: keyof typeof problems) => touched && problems[field]

  const pay = useMutation({
    mutationFn: async () => {
      if (!exp) return
      const returnUrl = `${window.location.origin}/settings/wallet/topup/return?topUp=${started.topUpId}`
      const outcome = await confirmCardPayment({
        publishableKey,
        clientSecret: started.clientSecret,
        returnUrl,
        card: {
          name: name.trim(),
          number,
          expMonth: exp.month,
          expYear: exp.year,
          cvc,
        },
      })
      // Only a decline or a validation problem is an error; the buyer fixes it and tries again.
      if (outcome.kind === 'error') throw new Error(outcome.message)
      // 3-D Secure: the bank's page, then back to `returnUrl`.
      if (outcome.kind === 'redirect') {
        window.location.assign(outcome.url)
        return
      }
      await navigate({ to: '/settings/wallet/topup/return', search: { topUp: started.topUpId } })
    },
    onError: (err) => setError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (Object.values(problems).some(Boolean)) return
    pay.mutate()
  }

  return (
    <form onSubmit={submit} noValidate>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('billing.topup.paying', { amount: formatMoney(started.amount, started.currency) })}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="card-name">{t('billing.card.name')}</Label>
          <Input
            id="card-name"
            autoComplete="cc-name"
            value={name}
            aria-invalid={invalid('name')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="card-number">{t('billing.card.number')}</Label>
          <Input
            id="card-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 1234 1234 1234"
            value={number}
            aria-invalid={invalid('number')}
            onChange={(e) => setNumber(formatCardNumber(e.target.value))}
          />
          {invalid('number') && (
            <p className="text-xs text-destructive">{t('billing.card.numberInvalid')}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-expiry">{t('billing.card.expiry')}</Label>
            <Input
              id="card-expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM / YY"
              value={expiry}
              aria-invalid={invalid('expiry')}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            />
            {invalid('expiry') && (
              <p className="text-xs text-destructive">{t('billing.card.expiryInvalid')}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-cvc">{t('billing.card.cvc')}</Label>
            <Input
              id="card-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder={'•'.repeat(cvcLength(number))}
              value={cvc}
              aria-invalid={invalid('cvc')}
              onChange={(e) => setCvc(cardDigits(e.target.value).slice(0, 4))}
            />
            {invalid('cvc') && (
              <p className="text-xs text-destructive">{t('billing.card.cvcInvalid')}</p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="payment-error">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pay.isPending}>
          {t('billing.topup.changeAmount')}
        </Button>
        <Button type="submit" className="ml-auto" loading={pay.isPending}>
          <Lock aria-hidden />
          {t('billing.topup.pay', { amount: formatMoney(started.amount, started.currency) })}
        </Button>
      </CardFooter>
    </form>
  )
}

/** Step one: pick a currency and an amount. */
function AmountStep({ onStarted }: { onStarted: (started: Started) => void }) {
  const { t } = useTranslation()
  const { data: config } = useSuspenseQuery(billingConfigQuery)
  const [currency, setCurrency] = useState(config.currencies[0]?.code ?? 'usd')
  const rule = config.currencies.find((c) => c.code === currency) ?? config.currencies[0]
  const [preset, setPreset] = useState<number | null>(rule?.presets[1] ?? null)
  const [custom, setCustom] = useState('')

  const amount = custom !== '' ? parseMoney(custom, currency) : preset
  const valid = rule !== undefined && amount !== null && amount >= rule.min && amount <= rule.max

  const start = useMutation({
    mutationFn: createTopUp,
    onSuccess: (data, input) => onStarted({ ...data, ...input }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const pickCurrency = (code: string) => {
    setCurrency(code)
    setCustom('')
    setPreset(config.currencies.find((c) => c.code === code)?.presets[1] ?? null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid && amount !== null) start.mutate({ currency, amount })
  }

  if (!rule) return null
  return (
    <form onSubmit={submit}>
      <CardContent className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('billing.topup.currency')}</legend>
          <div className="flex flex-wrap gap-2">
            {config.currencies.map((c) => (
              <Button
                key={c.code}
                type="button"
                size="sm"
                variant={c.code === currency ? 'default' : 'outline'}
                aria-pressed={c.code === currency}
                onClick={() => pickCurrency(c.code)}
                data-testid={`currency-${c.code}`}
              >
                {c.code.toUpperCase()}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('billing.topup.amount')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {rule.presets.map((p) => (
              <Button
                key={p}
                type="button"
                variant={custom === '' && preset === p ? 'default' : 'outline'}
                aria-pressed={custom === '' && preset === p}
                onClick={() => {
                  setPreset(p)
                  setCustom('')
                }}
                data-testid={`preset-${p}`}
              >
                {formatMoney(p, currency)}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-amount">{t('billing.topup.custom')}</Label>
          <Input
            id="custom-amount"
            inputMode={currencyDigits(currency) === 0 ? 'numeric' : 'decimal'}
            autoComplete="off"
            placeholder={formatMoney(rule.min, currency)}
            value={custom}
            aria-invalid={custom !== '' && !valid}
            aria-describedby="amount-range"
            onChange={(e) => setCustom(e.target.value)}
          />
          <p
            id="amount-range"
            className={cn(
              'text-xs',
              custom !== '' && !valid ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t('billing.topup.range', {
              min: formatMoney(rule.min, currency),
              max: formatMoney(rule.max, currency),
            })}
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {t('billing.topup.secure')}
        </p>
        <Button type="submit" className="ml-auto" disabled={!valid} loading={start.isPending}>
          {t('billing.topup.continue')}
        </Button>
      </CardFooter>
    </form>
  )
}

export function TopUpForm() {
  const { t } = useTranslation()
  const { data: config } = useSuspenseQuery(billingConfigQuery)
  const [started, setStarted] = useState<Started | null>(null)

  if (!config.enabled || !config.publishableKey)
    return (
      <Card>
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6" data-testid="topup-disabled">
          {t('billing.topup.disabled')}
        </p>
      </Card>
    )

  return (
    <Card>
      {started ? (
        <PaymentStep
          // A new payment is a new form: nothing typed for one amount carries over to the next.
          key={started.clientSecret}
          started={started}
          publishableKey={config.publishableKey}
          onBack={() => setStarted(null)}
        />
      ) : (
        <AmountStep onStarted={setStarted} />
      )}
    </Card>
  )
}
