import type { MailMarkup, MailSpec, Translate } from '../contracts'

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

/** How a value looks in the HTML version. The value is escaped first, so markup only ever comes from here. */
const MARKUP: Record<MailMarkup, (escaped: string) => string> = {
  bold: (v) => `<b>${v}</b>`,
  code: (v) => `<b style="font-size:24px;letter-spacing:4px">${v}</b>`,
}

/**
 * One message, two renderings. `values` are plain text; `markup` lists the placeholders the HTML version shows with markup
 * instead (bold, a big code). The rest is escaped.
 */
export function composeMail(t: Translate, template: string, spec: MailSpec): MailContent {
  const { values = {}, markup = {}, actionUrl } = spec
  const key = (part: string) => `mail.${template}.${part}`
  const escaped = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, escapeHtml(String(value))]),
  )
  const styled = Object.fromEntries(
    Object.entries(markup).map(([name, style]) => [name, MARKUP[style](escaped[name] ?? '')]),
  )
  const title = t(key('title'))
  const text = t(key('body'), values)
  const html = t(key('body'), { ...escaped, ...styled })
  const label = actionUrl ? t(key('action')) : ''
  const button = actionUrl
    ? `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>
       <p style="color:#666;font-size:13px">${escapeHtml(t('common.openLink'))} <br>${escapeHtml(actionUrl)}</p>`
    : ''
  return {
    subject: t(key('subject'), values),
    text: actionUrl ? `${text}\n\n${label}: ${actionUrl}` : text,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h2>${escapeHtml(title)}</h2><p>${html}</p>${button}</div>`,
  }
}
