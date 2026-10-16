import { DEFAULT_LOCALE, type Locale } from '@app/shared-types'
import { formatDay } from '#/shared/i18n/format'
import { type Translator, translate } from './messages'
import type { en } from './messages/en'

export interface MailContent {
  subject: string
  text: string
  html: string
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

const bold = (s: string) => `<b>${escapeHtml(s)}</b>`

type MailKey = keyof (typeof en)['mail']

interface Action {
  label: string
  url: string
}

/**
 * One message, two renderings. `values` are plain text; `markup` lists the ones the HTML version shows with markup
 * instead (bold, a big code) — they are the only place HTML comes from, and the rest is escaped.
 */
function compose(
  t: Translator,
  key: MailKey,
  values: Record<string, string | number>,
  options: { markup?: Record<string, string>; action?: Action } = {},
): MailContent {
  const { markup = {}, action } = options
  const escaped = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, escapeHtml(String(value))]),
  )
  const title = t(`mail.${key}.title`)
  const text = t(`mail.${key}.body`, values)
  const html = t(`mail.${key}.body`, { ...escaped, ...markup })
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
       <p style="color:#666;font-size:13px">${escapeHtml(t('common.openLink'))} <br>${escapeHtml(action.url)}</p>`
    : ''
  return {
    subject: t(`mail.${key}.subject`, values),
    text: action ? `${text}\n\n${action.label}: ${action.url}` : text,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h2>${escapeHtml(title)}</h2><p>${html}</p>${button}</div>`,
  }
}

const minutes = (t: Translator, count: number) => t('common.minutes', { count })

export function magicLinkMail(
  params: { url: string; expiresInMinutes: number },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  return compose(
    t,
    'magicLink',
    { expires: minutes(t, params.expiresInMinutes) },
    { action: { label: t('mail.magicLink.action'), url: params.url } },
  )
}

export function stepUpCodeMail(
  params: { code: string; expiresInMinutes: number },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  return compose(
    t,
    'stepUpCode',
    { code: params.code, expires: minutes(t, params.expiresInMinutes) },
    {
      markup: {
        code: `<b style="font-size:24px;letter-spacing:4px">${escapeHtml(params.code)}</b>`,
      },
    },
  )
}

export function welcomeMail(
  params: { email: string; appUrl: string },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  return compose(
    t,
    'welcome',
    { email: params.email },
    {
      markup: { email: bold(params.email) },
      action: { label: t('mail.welcome.action'), url: params.appUrl },
    },
  )
}

export function confirmEmailChangeMail(
  params: { url: string; expiresInMinutes: number },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  return compose(
    t,
    'confirmEmailChange',
    { expires: minutes(t, params.expiresInMinutes) },
    { action: { label: t('mail.confirmEmailChange.action'), url: params.url } },
  )
}

export function emailChangedNoticeMail(
  params: { oldEmail: string; newEmail: string },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  return compose(
    translate(locale),
    'emailChanged',
    { oldEmail: params.oldEmail, newEmail: params.newEmail },
    { markup: { oldEmail: bold(params.oldEmail), newEmail: bold(params.newEmail) } },
  )
}

export function dataExportReadyMail(
  params: { url: string; expiresAt: string },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  return compose(
    t,
    'dataExportReady',
    { date: formatDay(params.expiresAt, locale) },
    { action: { label: t('mail.dataExportReady.action'), url: params.url } },
  )
}

export function accountDeletionScheduledMail(
  params: { scheduledFor: string; cancelUrl: string },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  const t = translate(locale)
  const date = formatDay(params.scheduledFor, locale)
  return compose(
    t,
    'deletionScheduled',
    { date },
    {
      markup: { date: bold(date) },
      action: { label: t('mail.deletionScheduled.action'), url: params.cancelUrl },
    },
  )
}

export function accountDeletionCancelledMail(locale: Locale = DEFAULT_LOCALE): MailContent {
  return compose(translate(locale), 'deletionCancelled', {})
}

export function accountDeletedMail(
  params: { email: string },
  locale: Locale = DEFAULT_LOCALE,
): MailContent {
  return compose(
    translate(locale),
    'accountDeleted',
    { email: params.email },
    { markup: { email: bold(params.email) } },
  )
}
