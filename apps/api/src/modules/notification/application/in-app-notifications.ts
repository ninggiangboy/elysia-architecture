import type { NotificationKind } from '../domain/notification'

/** What to tell a user, before it gets an id and a timestamp. */
export interface NotificationDraft {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  data?: Record<string, unknown>
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

/** "Chrome on macOS" from a User-Agent; enough to recognise a device, not for anything security-relevant. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'an unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
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
