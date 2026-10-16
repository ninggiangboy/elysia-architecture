import { DEFAULT_LOCALE, isLocale } from '@app/shared-types'
import type { LocaleResolver } from './ports'

/** The language the event itself carries, else the default. Used where nobody can be looked up (and in tests). */
export const payloadLocale: LocaleResolver = {
  resolve: async (recipient) => (isLocale(recipient.locale) ? recipient.locale : DEFAULT_LOCALE),
}
