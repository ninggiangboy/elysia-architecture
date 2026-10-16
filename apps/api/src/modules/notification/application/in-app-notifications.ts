import type { NotificationKind } from '../domain/notification'

/** What to tell a user, before it gets an id and a timestamp. */
export interface NotificationDraft {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  data?: Record<string, unknown>
  /**
   * Fold repeats into one notification (no draft uses it yet): while the user's latest notification with this `key` is unread and at most
   * `withinMs` old, a new draft bumps its `count` and replaces its content instead of adding a row.
   */
  group?: { key: string; withinMs: number }
}

export const welcomeNotification = (p: { userId: string }): NotificationDraft => ({
  userId: p.userId,
  kind: 'welcome',
  title: 'Welcome aboard',
  body: 'Your account is ready. Add a display name and an avatar to make it yours.',
  data: { link: '/' },
})

export const emailChangedNotification = (p: {
  userId: string
  newEmail: string
}): NotificationDraft => ({
  userId: p.userId,
  kind: 'email_changed',
  title: 'Your email address was changed',
  body: `Your account email is now ${p.newEmail}.`,
  data: { link: '/' },
})

export const suspiciousSessionNotification = (p: { userId: string }): NotificationDraft => ({
  userId: p.userId,
  kind: 'security_alert',
  title: 'A device was signed out for your safety',
  body: 'We saw a sign-in token being reused, which can mean it was stolen, so we signed that device out. Review your signed-in devices.',
  data: { link: '/' },
})

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
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'an unknown device'
  const browser = detect(BROWSERS, userAgent)
  const os = detect(SYSTEMS, userAgent)
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'an unknown device'
}

export const newSignInNotification = (p: {
  userId: string
  sessionId: string
  ip: string | null
  userAgent: string | null
}): NotificationDraft => ({
  userId: p.userId,
  kind: 'new_sign_in',
  title: 'New sign-in to your account',
  body: `${describeDevice(p.userAgent)}${p.ip ? ` (${p.ip})` : ''} signed in. If this was not you, sign that device out.`,
  data: { sessionId: p.sessionId, ip: p.ip, userAgent: p.userAgent, link: '/' },
})

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' }
const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider

const securityAlert = (
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): NotificationDraft => ({
  userId,
  kind: 'security_alert',
  title,
  body,
  data: { ...data, link: '/security' },
})

export const passkeyAddedNotification = (p: { userId: string; name: string }) =>
  securityAlert(
    p.userId,
    'A passkey was added',
    `"${p.name}" can now sign in to your account. If this was not you, remove it and sign out your other devices.`,
  )

export const passkeyRemovedNotification = (p: { userId: string; name: string }) =>
  securityAlert(
    p.userId,
    'A passkey was removed',
    `"${p.name}" can no longer sign in to your account.`,
  )

export const oauthLinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(
    p.userId,
    `${providerName(p.provider)} was connected`,
    `Your ${providerName(p.provider)} account can now sign in to your account. If this was not you, disconnect it and sign out your other devices.`,
  )

export const oauthUnlinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(
    p.userId,
    `${providerName(p.provider)} was disconnected`,
    `Your ${providerName(p.provider)} account can no longer sign in to your account.`,
  )
