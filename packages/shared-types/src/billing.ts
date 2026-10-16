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
