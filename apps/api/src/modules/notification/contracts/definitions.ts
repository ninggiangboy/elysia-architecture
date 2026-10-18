import type { Catalog, Locale } from '@app/shared-types'

/**
 * What a producer module hands to notification so its events reach people. Notification knows no producer: each one ships
 * a `NotificationIntegration` (its `integrations/notification.ts`) and the composition root installs the ones it wants.
 * Plain types only; the producer imports them with `import type`, so notification stays an optional dependency.
 */

/** The categories a client groups and decorates notifications by (an icon per kind). */
export const NOTIFICATION_KINDS = [
  'welcome',
  'email_changed',
  'new_sign_in',
  'security_alert',
  'data_export',
  'payment',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** What to tell a user, before it gets an id and a timestamp. */
export interface NotificationDraft {
  userId: string
  kind: NotificationKind
  /**
   * Which message the client writes from `data` in the reader's language (a key under `inApp.` in the catalogs, declared in
   * the integration's `templates`). Leave it out for a custom notification and give `title` and `body` instead. The text is
   * NOT stored for a templated one, so it follows the reader when they change language.
   */
  template?: string
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

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** The reader's language and the messages in it, for filling a template. */
export interface TemplateContext {
  locale: Locale
  t: Translate
}

/** Turns a notification's raw `data` into the values its message placeholders take (formatted for `ctx.locale`). */
export type TemplateValues = (
  data: Record<string, unknown>,
  ctx: TemplateContext,
) => Record<string, string>

/** Integration event → in-app notification (stored, shown in the inbox, pushed as Web Push). `build` returns `null` to say nothing. */
export interface InAppDefinition<TPayload = unknown> {
  /** Handler name = consumer group = inbox key: keep it stable. */
  name: string
  eventType: string
  build(payload: TPayload): NotificationDraft | null
}

/** How a value is shown in the HTML version of a mail; the text version always shows it plain. */
export type MailMarkup = 'bold' | 'code'

export interface MailContext extends TemplateContext {
  /** Where the web app lives, for building links. No trailing slash. */
  webAppUrl: string
}

/** What a mail says; the notification module renders it from the catalog entry `mail.<template>`. */
export interface MailSpec {
  to: string
  /** Placeholder values of `mail.<template>.{subject,title,body}`, formatted for the reader. */
  values?: Record<string, string | number>
  /** Placeholders the HTML version shows with markup instead of plain text. */
  markup?: Record<string, MailMarkup>
  /** A button below the text. Its label is `mail.<template>.action`. */
  actionUrl?: string
  /** ISO-8601. After this time the mail is pointless (a link that expired): it is skipped instead of sent late. */
  expiresAt?: string
}

/** Integration event → mail. */
export interface MailDefinition<TPayload = unknown> {
  name: string
  eventType: string
  /** The entry under `mail.` in the catalogs; the module checks at startup that it exists in every language. */
  template: string
  build(payload: TPayload, ctx: MailContext): MailSpec
}

/** Integration event that ends a login session → the Web Push subscription that session registered is dropped. */
export interface DropPushOn<TPayload = unknown> {
  name: string
  eventType: string
  session(payload: TPayload): { userId: string; sessionId: string }
}

export interface NotificationIntegration {
  inApp?: readonly InAppDefinition[]
  /** The templates `inApp` drafts use, and how each fills its message. */
  templates?: Readonly<Record<string, TemplateValues>>
  mails?: readonly MailDefinition[]
  dropPushOn?: readonly DropPushOn[]
  /** Messages of the producer's templates (`mail.*`, `inApp.*`, extra `common.*`) in every supported language. */
  messages?: Readonly<Record<Locale, Catalog>>
}

export interface Recipient {
  locale?: string | null
  userId?: string
}

/** Which language to write to someone in: the one the event carries, else the account's preference, else the default. */
export interface LocaleResolver {
  resolve(recipient: Recipient): Promise<Locale>
}
