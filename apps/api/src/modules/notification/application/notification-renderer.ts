import type { Locale } from '@app/shared-types'
import type { TemplateValues, Translate } from '../contracts'

/** The title and body of a templated notification in a language; `null` for a template this build does not know. */
export type NotificationRenderer = (
  template: string,
  data: Record<string, unknown>,
  locale: Locale,
) => { title: string; body: string } | null

/**
 * The web app writes templated notifications itself (`notifications.templates.<name>` in its catalog); this server copy
 * exists for what leaves the app as text — Web Push — and is written at send time in the account's language.
 */
export function createNotificationRenderer(
  templates: Readonly<Record<string, TemplateValues>>,
  translate: (locale: Locale) => Translate,
): NotificationRenderer {
  return (template, data, locale) => {
    const values = Object.hasOwn(templates, template) ? templates[template] : undefined
    if (!values) return null
    const t = translate(locale)
    const params = values(data, { locale, t })
    return {
      title: t(`inApp.${template}.title`, params),
      body: t(`inApp.${template}.body`, params),
    }
  }
}
