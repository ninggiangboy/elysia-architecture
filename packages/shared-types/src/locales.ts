import { defineLocales } from '@kit/i18n'

/** Languages the product speaks, shared by web ↔ api. Add a language here, then a catalog on each side. */
const locales = defineLocales(['en', 'vi'], {
  default: 'en',
  names: { en: 'English', vi: 'Tiếng Việt' },
})

export const { LOCALES, DEFAULT_LOCALE, LOCALE_NAMES, isLocale, matchLocale, negotiateLocale } =
  locales

export type Locale = (typeof LOCALES)[number]
