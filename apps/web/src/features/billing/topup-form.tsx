import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { currencyDigits, parseMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { billingConfigQuery, createTopUp } from './queries'

// One Stripe.js per key, however many times the form mounts.
const stripes = new Map<string, Promise<Stripe | null>>()
const stripeFor = (publishableKey: string) => {
  let stripe = stripes.get(publishableKey)
  if (!stripe) {
    stripe = loadStripe(publishableKey)
    stripes.set(publishableKey, stripe)
  }
  return stripe
}

const isDark = () => document.documentElement.classList.contains('dark')

interface Started {
  topUpId: string
  clientSecret: string
  currency: string
  amount: number
}

/** Step two: the card (or other method) form Stripe draws, for the amount chosen in step one. */
function PaymentStep({ started, onBack }: { started: Started; onBack: () => void }) {
  const { t } = useTranslation()
  const stripe = useStripe()
  const elements = useElements()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const pay = useMutation({
    mutationFn: async () => {
      if (!stripe || !elements) return
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // Where a method that leaves the page (a bank redirect, 3-D Secure) brings the buyer back.
          return_url: `${window.location.origin}/topup/return?topUp=${started.topUpId}`,
        },
        // A card that needs nothing more is settled right here, without a round trip through Stripe's page.
        redirect: 'if_required',
      })
      // Only a decline or a validation problem comes back as an error; the buyer fixes it and tries again.
      if (result.error) throw new Error(result.error.message ?? t('common.unknownError'))
      await navigate({ to: '/topup/return', search: { topUp: started.topUpId } })
    },
    onError: (err) => setError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    pay.mutate()
  }

  return (
    <form onSubmit={submit}>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('billing.topup.paying', { amount: formatMoney(started.amount, started.currency) })}
        </p>
        <PaymentElement />
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
        <Button
          type="submit"
          className="ml-auto"
          disabled={!stripe || !elements}
          loading={pay.isPending}
        >
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
  const stripe = useMemo(
    () => (config.publishableKey ? stripeFor(config.publishableKey) : null),
    [config.publishableKey],
  )

  if (!config.enabled || !stripe)
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
        <Elements
          // A new payment is a new Elements: the client secret cannot change under a mounted one.
          key={started.clientSecret}
          stripe={stripe}
          options={{
            clientSecret: started.clientSecret,
            appearance: { theme: isDark() ? 'night' : 'stripe' },
          }}
        >
          <PaymentStep started={started} onBack={() => setStarted(null)} />
        </Elements>
      ) : (
        <AmountStep onStarted={setStarted} />
      )}
    </Card>
  )
}
