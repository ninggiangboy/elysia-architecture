export interface CardDetails {
  name: string
  number: string
  expMonth: number
  expYear: number
  cvc: string
}

export type ConfirmOutcome =
  /** Paid (or on its way: the webhook settles it). */
  | { kind: 'done' }
  /** The bank wants the buyer to authenticate (3-D Secure) on this page, then sends them to `return_url`. */
  | { kind: 'redirect'; url: string }
  /** Declined or invalid: Stripe's own wording, safe to show. */
  | { kind: 'error'; message: string }

interface PaymentIntentResponse {
  status?: string
  next_action?: { type?: string; redirect_to_url?: { url?: string } } | null
  error?: { message?: string }
}

/**
 * Pays a PaymentIntent with a card straight from the browser: the same call Stripe.js makes, without Stripe.js.
 * Only the publishable key and the intent's client secret are used, so the card never reaches our server.
 * (Stripe must allow raw card numbers on the account: see "Raw card data APIs" in the Dashboard.)
 */
export async function confirmCardPayment(input: {
  publishableKey: string
  clientSecret: string
  card: CardDetails
  returnUrl: string
}): Promise<ConfirmOutcome> {
  const intentId = input.clientSecret.split('_secret_')[0]
  const body = new URLSearchParams({
    client_secret: input.clientSecret,
    return_url: input.returnUrl,
    'payment_method_data[type]': 'card',
    'payment_method_data[card][number]': input.card.number.replace(/\D/g, ''),
    'payment_method_data[card][exp_month]': String(input.card.expMonth),
    'payment_method_data[card][exp_year]': String(input.card.expYear),
    'payment_method_data[card][cvc]': input.card.cvc,
    'payment_method_data[billing_details][name]': input.card.name,
  })
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.publishableKey}` },
    body,
  })
  const intent = (await res.json().catch(() => ({}))) as PaymentIntentResponse
  if (!res.ok || intent.error)
    return { kind: 'error', message: intent.error?.message ?? `Stripe answered ${res.status}` }

  const redirect = intent.next_action?.redirect_to_url?.url
  if (intent.status === 'requires_action' && redirect) return { kind: 'redirect', url: redirect }
  if (intent.status === 'succeeded' || intent.status === 'processing') return { kind: 'done' }
  return { kind: 'error', message: 'The payment could not be completed' }
}
