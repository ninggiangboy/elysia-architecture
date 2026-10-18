/**
 * Currencies a wallet can be topped up in. Amounts everywhere are integers in the currency's smallest unit — what
 * Stripe calls "minor units": cents for USD/EUR, whole dong for VND (a zero-decimal currency). The server enforces
 * `min`/`max`; the web app only reads them to offer presets.
 */
export const TOPUP_CURRENCIES = {
  usd: { min: 500, max: 100_000, presets: [500, 1000, 2000, 5000] },
  eur: { min: 500, max: 100_000, presets: [500, 1000, 2000, 5000] },
  vnd: { min: 20_000, max: 25_000_000, presets: [50_000, 100_000, 200_000, 500_000] },
} as const

export type TopUpCurrency = keyof typeof TOPUP_CURRENCIES

export const TOPUP_CURRENCY_CODES = Object.keys(TOPUP_CURRENCIES) as TopUpCurrency[]

export const TOPUP_STATUSES = ['pending', 'succeeded', 'failed', 'canceled'] as const

export type TopUpStatus = (typeof TOPUP_STATUSES)[number]

/**
 * The documents billing issues for a top-up. An `invoice` is issued when the top-up starts (`open`), becomes `paid` when
 * the payment succeeds (and a `receipt` is issued with it) or `void` when it is canceled. A `credit_note` follows a refund
 * or a dispute; it is `void` again when the dispute is won.
 */
export const DOCUMENT_KINDS = ['invoice', 'receipt', 'credit_note'] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_STATUSES = ['open', 'paid', 'void', 'issued'] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]
