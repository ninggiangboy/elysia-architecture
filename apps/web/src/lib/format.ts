import { currentLocale, i18n } from '@/i18n'
import { formatMoneyIn } from './money'

const STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** "Oct 16, 2026, 6:15 PM" / "16 thg 10, 2026, 18:15", in the app's language. */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })

/** "October 16, 2026 (UTC)" / "16 tháng 10, 2026 (UTC)": the calendar day in UTC, the way the server's mail spells it. */
export const formatUtcDay = (iso: string) =>
  `${new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso))} (UTC)`

/** "just now", "5 minutes ago", "yesterday", … */
export function formatRelative(iso: string, now = Date.now()) {
  const relative = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' })
  let value = (new Date(iso).getTime() - now) / 1000
  if (Math.abs(value) < 45) return i18n.t('time.justNow')
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit)
    value /= size
  }
  return formatDate(iso)
}

/** "1.4 MB" */
export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/** "$20.00" / "20.000 ₫": an amount in the currency's smallest unit (what the API speaks), in the app's language. */
export const formatMoney = (amount: number, currency: string) =>
  formatMoneyIn(currentLocale(), amount, currency)
