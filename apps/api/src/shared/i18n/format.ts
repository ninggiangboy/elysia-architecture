import type { Locale } from '@app/shared-types'

/** "October 16, 2026 (UTC)" / "16 tháng 10, 2026 (UTC)": the calendar day in UTC, spelled the reader's way. */
export const formatDay = (iso: string, locale: Locale) =>
  `${new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso))} (UTC)`
