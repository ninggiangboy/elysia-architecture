import { DEFAULT_LOCALE, LOCALES, type Locale } from '@app/shared-types/locales'
import {
  type Catalog,
  createTranslator,
  mergeCatalogs,
  messagePaths,
  overrideCatalog,
} from '@kit/i18n'
import type { NotificationIntegration, Translate } from '../../contracts'
import { en } from './en'
import { vi } from './vi'

const BASE: Record<Locale, Catalog> = { en, vi }

export interface MessagesOptions {
  integrations: readonly NotificationIntegration[]
  /** Rewords messages that exist (the one layer allowed to replace a key): `{ vi: { mail: { magicLink: { subject: '…' } } } }`. */
  overrides?: Partial<Record<Locale, Catalog>>
}

/** The merged catalogs and the translator over them. */
export interface Messages {
  catalogs: Record<Locale, Catalog>
  translate(locale: Locale): Translate
}

/** The messages a mail needs (`mail.<template>.subject|title|body`) and an in-app template needs (`inApp.<template>.title|body`). */
function requiredKeys(integrations: readonly NotificationIntegration[]) {
  const keys = ['common.minutes', 'common.openLink']
  for (const integration of integrations) {
    for (const template of Object.keys(integration.templates ?? {}))
      keys.push(`inApp.${template}.title`, `inApp.${template}.body`)
    for (const mail of integration.mails ?? [])
      keys.push(
        `mail.${mail.template}.subject`,
        `mail.${mail.template}.title`,
        `mail.${mail.template}.body`,
      )
  }
  return keys
}

/**
 * Merges the module's own sentences with those of every installed integration, applies the overrides and checks that every
 * message a template or mail refers to exists in every language — so a missing translation fails at startup, not in a
 * user's inbox.
 */
export function createMessages({ integrations, overrides }: MessagesOptions): Messages {
  const catalogs = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      overrideCatalog(
        mergeCatalogs(BASE[locale], ...integrations.map((i) => i.messages?.[locale])),
        overrides?.[locale],
      ),
    ]),
  ) as Record<Locale, Catalog>

  const required = requiredKeys(integrations)
  for (const locale of LOCALES) {
    const present = messagePaths(catalogs[locale])
    const missing = required.filter((key) => !present.has(key))
    if (missing.length > 0)
      throw new Error(`Notification messages missing in "${locale}": ${missing.join(', ')}`)
  }

  const translations = Object.fromEntries(
    LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map((locale) => [
      locale,
      catalogs[locale],
    ]),
  ) as Record<Exclude<Locale, typeof DEFAULT_LOCALE>, Catalog>
  const translator = createTranslator<Catalog>(
    DEFAULT_LOCALE,
    catalogs[DEFAULT_LOCALE],
    translations,
  )
  return { catalogs, translate: (locale) => translator(locale) as Translate }
}
