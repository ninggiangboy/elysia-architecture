import { DEFAULT_LOCALE, type Locale } from '@app/shared-types'
import { formatDay } from '#/shared/i18n/format'
import type { NotificationKind } from '../domain/notification'
import { translate } from './messages'

/** What to tell a user, before it gets an id and a timestamp. */
export interface NotificationDraft {
  userId: string
  kind: NotificationKind
  /**
   * Which message the client writes from `data` in the reader's language (a key of `TEMPLATES`). Leave it out for a custom
   * notification and give `title` and `body` instead. The text is NOT stored for a templated one, so it follows the reader
   * when they change language.
   */
  template?: NotificationTemplate
  title?: string
  body?: string
  /** What the template is filled from: raw values (an ISO date, a provider id, a user agent), never text in a language. */
  data?: Record<string, unknown>
  /**
   * Fold repeats into one notification (no draft uses it yet): while the user's latest notification with this `key` is unread and at most
   * `withinMs` old, a new draft bumps its `count` and replaces its content instead of adding a row.
   */
  group?: { key: string; withinMs: number }
}

type Matchers = ReadonlyArray<readonly [RegExp, string]>

// Order matters: Edge and Chrome UAs also contain "Chrome/" and "Safari/".
const BROWSERS: Matchers = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: Matchers = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]
const detect = (matchers: Matchers, ua: string) => matchers.find(([re]) => re.test(ua))?.[1] ?? null

/** "Chrome on macOS" from a User-Agent; enough to recognise a device, not for anything security-relevant. */
export function describeDevice(userAgent: string | null, locale: Locale = DEFAULT_LOCALE): string {
  const t = translate(locale)
  if (!userAgent) return t('common.unknownDevice')
  const browser = detect(BROWSERS, userAgent)
  const os = detect(SYSTEMS, userAgent)
  if (browser && os) return t('common.deviceOn', { browser, os })
  return browser ?? os ?? t('common.unknownDevice')
}

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' }
const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * The templates and what each is filled with, from the notification's `data`. The web app has the same list in its
 * catalog (`notifications.templates.<name>`) and writes the messages itself; this server copy exists for what leaves the
 * app as text — Web Push — and is written at send time in the account's language.
 */
const TEMPLATES = {
  welcome: () => ({}),
  emailChanged: (d) => ({ email: str(d.email) }),
  suspiciousSession: () => ({}),
  newSignIn: (d, locale) => ({
    device: describeDevice(typeof d.userAgent === 'string' ? d.userAgent : null, locale),
    ip: typeof d.ip === 'string' && d.ip ? ` (${d.ip})` : '',
  }),
  passkeyAdded: (d) => ({ name: str(d.name) }),
  passkeyRemoved: (d) => ({ name: str(d.name) }),
  oauthLinked: (d) => ({ provider: providerName(str(d.provider)) }),
  oauthUnlinked: (d) => ({ provider: providerName(str(d.provider)) }),
  dataExportReady: (d, locale) => ({ date: formatDay(str(d.expiresAt), locale) }),
  dataExportFailed: () => ({}),
  deletionScheduled: (d, locale) => ({ date: formatDay(str(d.scheduledFor), locale) }),
  deletionCancelled: () => ({}),
} satisfies Record<
  string,
  (data: Record<string, unknown>, locale: Locale) => Record<string, string>
>

export type NotificationTemplate = keyof typeof TEMPLATES

/** The title and body of a templated notification in `locale`; `null` for a template this build does not know. */
export function renderNotification(
  template: string,
  data: Record<string, unknown>,
  locale: Locale,
): { title: string; body: string } | null {
  if (!(template in TEMPLATES)) return null
  const key = template as NotificationTemplate
  const values = TEMPLATES[key](data, locale)
  const t = translate(locale)
  return { title: t(`inApp.${key}.title`, values), body: t(`inApp.${key}.body`, values) }
}

const templated = (
  userId: string,
  kind: NotificationKind,
  template: NotificationTemplate,
  data: Record<string, unknown> = {},
): NotificationDraft => ({ userId, kind, template, data: { link: '/', ...data } })

export const welcomeNotification = (p: { userId: string }) =>
  templated(p.userId, 'welcome', 'welcome')

export const emailChangedNotification = (p: { userId: string; newEmail: string }) =>
  templated(p.userId, 'email_changed', 'emailChanged', { email: p.newEmail })

export const suspiciousSessionNotification = (p: { userId: string }) =>
  templated(p.userId, 'security_alert', 'suspiciousSession')

export const newSignInNotification = (p: {
  userId: string
  sessionId: string
  ip: string | null
  userAgent: string | null
}) =>
  templated(p.userId, 'new_sign_in', 'newSignIn', {
    sessionId: p.sessionId,
    ip: p.ip,
    userAgent: p.userAgent,
  })

const securityAlert = (
  userId: string,
  template: NotificationTemplate,
  data: Record<string, unknown> = {},
) => templated(userId, 'security_alert', template, { link: '/security', ...data })

export const passkeyAddedNotification = (p: { userId: string; name: string }) =>
  securityAlert(p.userId, 'passkeyAdded', { name: p.name })

export const passkeyRemovedNotification = (p: { userId: string; name: string }) =>
  securityAlert(p.userId, 'passkeyRemoved', { name: p.name })

export const oauthLinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(p.userId, 'oauthLinked', { provider: p.provider })

export const oauthUnlinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(p.userId, 'oauthUnlinked', { provider: p.provider })

export const dataExportReadyNotification = (p: { userId: string; expiresAt: string }) =>
  templated(p.userId, 'data_export', 'dataExportReady', {
    link: '/privacy',
    expiresAt: p.expiresAt,
  })

export const dataExportFailedNotification = (p: { userId: string }) =>
  templated(p.userId, 'data_export', 'dataExportFailed', { link: '/privacy' })

export const accountDeletionScheduledNotification = (p: { userId: string; scheduledFor: string }) =>
  securityAlert(p.userId, 'deletionScheduled', {
    link: '/privacy',
    scheduledFor: p.scheduledFor,
    deletionScheduledFor: p.scheduledFor,
  })

export const accountDeletionCancelledNotification = (p: { userId: string }) =>
  securityAlert(p.userId, 'deletionCancelled', { link: '/privacy' })
