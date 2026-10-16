import { i18n } from '@/i18n'
import { describeDevice } from '@/lib/device'
import { formatUtcDay } from '@/lib/format'

interface Notification {
  template: string | null
  title: string
  body: string
  data: Record<string, unknown>
}

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' }

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * What each template is filled with, from the notification's raw `data`. The server keeps the same list for Web Push
 * (`TEMPLATES` in the API's `in-app-notifications.ts`): a template added there needs a catalog entry and a line here.
 */
const PARAMS: Record<string, (data: Record<string, unknown>) => Record<string, string>> = {
  emailChanged: (d) => ({ email: str(d.email) }),
  newSignIn: (d) => ({
    device: describeDevice(typeof d.userAgent === 'string' ? d.userAgent : null),
    ip: str(d.ip) ? ` (${str(d.ip)})` : '',
  }),
  passkeyAdded: (d) => ({ name: str(d.name) }),
  passkeyRemoved: (d) => ({ name: str(d.name) }),
  oauthLinked: (d) => ({ provider: PROVIDER_NAMES[str(d.provider)] ?? str(d.provider) }),
  oauthUnlinked: (d) => ({ provider: PROVIDER_NAMES[str(d.provider)] ?? str(d.provider) }),
  dataExportReady: (d) => ({ date: formatUtcDay(str(d.expiresAt)) }),
  deletionScheduled: (d) => ({ date: formatUtcDay(str(d.scheduledFor)) }),
}

/**
 * The title and body to show: written from the template in the app's language now (so a language change reaches
 * notifications that already exist), or the stored text of a custom notification, or of a template this build does
 * not know.
 */
export function notificationText(n: Notification): { title: string; body: string } {
  const key = `notifications.templates.${n.template}`
  if (n.template && i18n.exists(`${key}.title`)) {
    const values = PARAMS[n.template]?.(n.data) ?? {}
    // The key is built at run time (the template name comes from the server), so it is not one of the typed literals.
    const translate = i18n.t.bind(i18n) as unknown as (key: string, values: object) => string
    return { title: translate(`${key}.title`, values), body: translate(`${key}.body`, values) }
  }
  return { title: n.title, body: n.body }
}

/** The toast line for a `notification.created` stream message. */
export function liveTitle(data: Record<string, unknown> | undefined): string {
  const title = data
    ? notificationText({
        template: typeof data.template === 'string' ? data.template : null,
        title: String(data.title ?? ''),
        body: '',
        data: (data.data ?? {}) as Record<string, unknown>,
      }).title
    : ''
  return title || i18n.t('notifications.live.fallback')
}
