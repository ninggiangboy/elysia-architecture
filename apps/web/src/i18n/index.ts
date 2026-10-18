import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  type Locale,
  negotiateLocale,
} from '@app/shared-types/locales'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { catalog } from './catalog'

const STORAGE_KEY = 'locale'

function saved(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    // Storage can be blocked (private mode): fall back to the browser's languages.
    return null
  }
}

/** What the person chose here before, else the best of their browser's languages we speak, else English. */
const detect = (): Locale =>
  saved() ?? negotiateLocale(navigator.languages.join(',')) ?? DEFAULT_LOCALE

void i18next.use(initReactI18next).init({
  lng: detect(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...LOCALES],
  resources: { en: { translation: catalog('en') }, vi: { translation: catalog('vi') } },
  // React already escapes what it renders.
  interpolation: { escapeValue: false },
  // Bundled catalogs: nothing to fetch, so init finishes before the first render.
  initAsync: false,
})

// Assistive tech, hyphenation and the browser's own UI (spellcheck, translate offer) follow the page language.
const applyLanguage = (locale: string) => {
  document.documentElement.lang = locale
}
applyLanguage(i18next.language)
i18next.on('languageChanged', applyLanguage)

// Another tab picked a language: follow it.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return
  const next = saved()
  if (next && next !== i18next.language) void i18next.changeLanguage(next)
})

export const i18n = i18next

/** The language the app is showing now (for code outside React: formatting, request headers). */
export const currentLocale = (): Locale =>
  isLocale(i18next.language) ? i18next.language : DEFAULT_LOCALE

/** Switches the app's language and remembers it on this browser. */
export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Not remembered, but still applied for this visit.
  }
  return i18next.changeLanguage(locale)
}

/** Follows the account's language (the source of truth once signed in); ignores one this build does not speak. */
export function adoptLocale(locale: string) {
  if (isLocale(locale) && locale !== currentLocale()) void setLocale(locale)
}
