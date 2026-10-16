/** Digits after the decimal point for a currency: 2 for USD (cents), 0 for VND (whole dong). */
export const currencyDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2

/** An amount in the currency's smallest unit (what the API speaks) written for `locale`. */
export const formatMoneyIn = (locale: string, amount: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount / 10 ** currencyDigits(currency),
  )

/** What a person typed ("25", "25.5") as an amount in the smallest unit, or `null` when it is not a number. */
export function parseMoney(input: string, currency: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 10 ** currencyDigits(currency))
}
