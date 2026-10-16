import type { Locale } from '@app/shared-types'

/** "$20.00" / "20.000 ₫": an amount in the currency's smallest unit (cents, whole dong…), spelled the reader's way. */
export const formatMoney = (amount: number, currency: string, locale: Locale) => {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency })
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
}

/** "October 16, 2026 (UTC)" / "16 tháng 10, 2026 (UTC)": the calendar day in UTC, spelled the reader's way. */
export const formatDay = (iso: string, locale: Locale) =>
  `${new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso))} (UTC)`
