const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** "Oct 16, 2026, 6:15 PM" */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** "just now", "5 minutes ago", "yesterday", … */
export function formatRelative(iso: string, now = Date.now()) {
  let value = (new Date(iso).getTime() - now) / 1000
  if (Math.abs(value) < 45) return 'just now'
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit)
    value /= size
  }
  return formatDate(iso)
}
