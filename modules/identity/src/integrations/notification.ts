import { DEFAULT_LOCALE, isLocale, type Locale } from '@app/shared-types/locales'
import type {
  InAppDefinition,
  LocaleResolver,
  MailContext,
  NotificationDraft,
  NotificationIntegration,
  NotificationKind,
  TemplateValues,
  Translate,
} from '@mod/notification/contracts'
import {
  type EmailChangedPayload,
  type EmailChangeRequestedPayload,
  type IdentityApi,
  IdentityEvents,
  type InvitationSentPayload,
  type MagicLinkRequestedPayload,
  type OAuthAccountLinkedPayload,
  type OAuthAccountUnlinkedPayload,
  type PasskeyAddedPayload,
  type PasskeyRemovedPayload,
  type PasswordChangedPayload,
  type PasswordResetRequestedPayload,
  type SessionRevokedPayload,
  type SessionStartedPayload,
  type SignupExistingAccountPayload,
  type SignupVerificationRequestedPayload,
  type StepUpCodeRequestedPayload,
  type TwoFactorDisabledPayload,
  type TwoFactorEnabledPayload,
  type UserRegisteredPayload,
} from '../contracts'
import { en } from './messages/en'
import { vi } from './messages/vi'

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
export function describeDevice(userAgent: string | null, t: Translate): string {
  if (!userAgent) return t('common.unknownDevice')
  const browser = detect(BROWSERS, userAgent)
  const os = detect(SYSTEMS, userAgent)
  if (browser && os) return t('common.deviceOn', { browser, os })
  return browser ?? os ?? t('common.unknownDevice')
}

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  discord: 'Discord',
}
const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider
const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** The templates and what each is filled with, from the notification's `data` (the same list the web catalog writes from). */
export const identityTemplates = {
  welcome: () => ({}),
  emailChanged: (d) => ({ email: str(d.email) }),
  suspiciousSession: () => ({}),
  newSignIn: (d, { t }) => ({
    device: describeDevice(typeof d.userAgent === 'string' ? d.userAgent : null, t),
    ip: typeof d.ip === 'string' && d.ip ? ` (${d.ip})` : '',
  }),
  passkeyAdded: (d) => ({ name: str(d.name) }),
  passkeyRemoved: (d) => ({ name: str(d.name) }),
  oauthLinked: (d) => ({ provider: providerName(str(d.provider)) }),
  oauthUnlinked: (d) => ({ provider: providerName(str(d.provider)) }),
  passwordChanged: (d, { t }) => ({ what: t(`common.passwordChange.${passwordChange(d.change)}`) }),
  twoFactorEnabled: () => ({}),
  twoFactorDisabled: () => ({}),
} satisfies Record<string, TemplateValues>

type IdentityTemplate = keyof typeof identityTemplates

const CHANGES = ['set', 'changed', 'removed', 'reset'] as const
const passwordChange = (value: unknown) => CHANGES.find((c) => c === value) ?? 'changed'

const templated = (
  userId: string,
  kind: NotificationKind,
  template: IdentityTemplate,
  data: Record<string, unknown> = {},
): NotificationDraft => ({ userId, kind, template, data: { link: '/', ...data } })

const securityAlert = (
  userId: string,
  template: IdentityTemplate,
  data: Record<string, unknown> = {},
) => templated(userId, 'security_alert', template, { link: '/settings/security', ...data })

export const welcomeNotification = (p: { userId: string }) =>
  templated(p.userId, 'welcome', 'welcome', { link: '/settings/profile' })

export const emailChangedNotification = (p: { userId: string; newEmail: string }) =>
  templated(p.userId, 'email_changed', 'emailChanged', {
    link: '/settings/account',
    email: p.newEmail,
  })

export const suspiciousSessionNotification = (p: { userId: string }) =>
  templated(p.userId, 'security_alert', 'suspiciousSession', { link: '/settings/security' })

export const newSignInNotification = (p: {
  userId: string
  sessionId: string
  ip: string | null
  userAgent: string | null
}) =>
  templated(p.userId, 'new_sign_in', 'newSignIn', {
    link: '/settings/security',
    sessionId: p.sessionId,
    ip: p.ip,
    userAgent: p.userAgent,
  })

export const passkeyAddedNotification = (p: { userId: string; name: string }) =>
  securityAlert(p.userId, 'passkeyAdded', { name: p.name })

export const passkeyRemovedNotification = (p: { userId: string; name: string }) =>
  securityAlert(p.userId, 'passkeyRemoved', { name: p.name })

export const oauthLinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(p.userId, 'oauthLinked', { provider: p.provider })

export const oauthUnlinkedNotification = (p: { userId: string; provider: string }) =>
  securityAlert(p.userId, 'oauthUnlinked', { provider: p.provider })

export const passwordChangedNotification = (p: { userId: string; change: string }) =>
  securityAlert(p.userId, 'passwordChanged', { change: p.change })

export const twoFactorEnabledNotification = (p: { userId: string }) =>
  securityAlert(p.userId, 'twoFactorEnabled')

export const twoFactorDisabledNotification = (p: { userId: string }) =>
  securityAlert(p.userId, 'twoFactorDisabled')

const minutesUntil = (iso: string) =>
  Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))

const expiresIn = ({ t }: MailContext, iso: string) =>
  t('common.minutes', { count: minutesUntil(iso) })

const link = ({ webAppUrl }: MailContext, path: string, token: string) =>
  `${webAppUrl}${path}?token=${encodeURIComponent(token)}`

export const identityNotifications = {
  templates: identityTemplates,
  inApp: [
    {
      name: 'notification.in-app-welcome',
      eventType: IdentityEvents.UserRegistered,
      build: (p: UserRegisteredPayload) => welcomeNotification(p),
    },
    {
      name: 'notification.in-app-email-changed',
      eventType: IdentityEvents.EmailChanged,
      build: (p: EmailChangedPayload) => emailChangedNotification(p),
    },
    {
      name: 'notification.in-app-new-sign-in',
      eventType: IdentityEvents.SessionStarted,
      // The first session of a new account is the sign-up itself — the welcome notification covers it.
      build: (p: SessionStartedPayload) => (p.newUser ? null : newSignInNotification(p)),
    },
    {
      name: 'notification.in-app-suspicious-session',
      eventType: IdentityEvents.SessionRevoked,
      // Logouts and "sign out that device" are the user's own doing — only token theft is news.
      build: (p: SessionRevokedPayload) =>
        p.reason === 'token_reuse' ? suspiciousSessionNotification(p) : null,
    },
    {
      name: 'notification.in-app-passkey-added',
      eventType: IdentityEvents.PasskeyAdded,
      build: (p: PasskeyAddedPayload) => passkeyAddedNotification(p),
    },
    {
      name: 'notification.in-app-passkey-removed',
      eventType: IdentityEvents.PasskeyRemoved,
      build: (p: PasskeyRemovedPayload) => passkeyRemovedNotification(p),
    },
    {
      name: 'notification.in-app-oauth-linked',
      eventType: IdentityEvents.OAuthAccountLinked,
      build: (p: OAuthAccountLinkedPayload) => oauthLinkedNotification(p),
    },
    {
      name: 'notification.in-app-oauth-unlinked',
      eventType: IdentityEvents.OAuthAccountUnlinked,
      build: (p: OAuthAccountUnlinkedPayload) => oauthUnlinkedNotification(p),
    },
    {
      name: 'notification.in-app-password-changed',
      eventType: IdentityEvents.PasswordChanged,
      build: (p: PasswordChangedPayload) => passwordChangedNotification(p),
    },
    {
      name: 'notification.in-app-two-factor-enabled',
      eventType: IdentityEvents.TwoFactorEnabled,
      build: (p: TwoFactorEnabledPayload) => twoFactorEnabledNotification(p),
    },
    {
      name: 'notification.in-app-two-factor-disabled',
      eventType: IdentityEvents.TwoFactorDisabled,
      build: (p: TwoFactorDisabledPayload) => twoFactorDisabledNotification(p),
    },
  ] satisfies InAppDefinition[],
  mails: [
    {
      name: 'notification.send-step-up-code',
      eventType: IdentityEvents.StepUpCodeRequested,
      template: 'stepUpCode',
      build: (p: StepUpCodeRequestedPayload, ctx: MailContext) => ({
        to: p.email,
        values: { code: p.code, expires: expiresIn(ctx, p.expiresAt) },
        markup: { code: 'code' as const },
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-magic-link',
      eventType: IdentityEvents.MagicLinkRequested,
      template: 'magicLink',
      build: (p: MagicLinkRequestedPayload, ctx: MailContext) => ({
        to: p.email,
        // Messages queued before codes existed carry none: the dash keeps the sentence readable.
        values: { expires: expiresIn(ctx, p.expiresAt), code: p.code ?? '—' },
        markup: { code: 'code' as const },
        actionUrl: link(ctx, '/auth/callback', p.token),
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-signup-verification',
      eventType: IdentityEvents.SignupVerificationRequested,
      template: 'signupVerification',
      build: (p: SignupVerificationRequestedPayload, ctx: MailContext) => ({
        to: p.email,
        values: { expires: expiresIn(ctx, p.expiresAt), code: p.code },
        markup: { code: 'code' as const },
        actionUrl: link(ctx, '/register/verify', p.token),
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-signup-existing-account',
      eventType: IdentityEvents.SignupExistingAccount,
      template: 'accountExists',
      build: (p: SignupExistingAccountPayload, ctx: MailContext) => ({
        to: p.email,
        values: { email: p.email },
        markup: { email: 'bold' as const },
        actionUrl: `${ctx.webAppUrl}/login`,
      }),
    },
    {
      name: 'notification.send-password-reset',
      eventType: IdentityEvents.PasswordResetRequested,
      template: 'passwordReset',
      build: (p: PasswordResetRequestedPayload, ctx: MailContext) => ({
        to: p.email,
        values: { expires: expiresIn(ctx, p.expiresAt) },
        actionUrl: link(ctx, '/password/reset', p.token),
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-password-changed-notice',
      eventType: IdentityEvents.PasswordChanged,
      template: 'passwordChanged',
      // Older messages carry no address; there is nobody to write to then.
      build: (p: PasswordChangedPayload, ctx: MailContext) => ({
        to: p.email ?? '',
        values: { what: ctx.t(`common.passwordChange.${passwordChange(p.change)}`) },
      }),
    },
    {
      name: 'notification.send-invitation',
      eventType: IdentityEvents.InvitationSent,
      template: 'invitation',
      build: (p: InvitationSentPayload, ctx: MailContext) => ({
        to: p.email,
        values: { inviter: p.inviterEmail ?? ctx.t('common.someone'), email: p.email },
        markup: { inviter: 'bold' as const, email: 'bold' as const },
        actionUrl: `${ctx.webAppUrl}/login`,
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-welcome',
      eventType: IdentityEvents.UserRegistered,
      template: 'welcome',
      build: (p: UserRegisteredPayload, ctx: MailContext) => ({
        to: p.email,
        values: { email: p.email },
        markup: { email: 'bold' as const },
        actionUrl: ctx.webAppUrl,
      }),
    },
    {
      name: 'notification.send-email-change-confirmation',
      eventType: IdentityEvents.EmailChangeRequested,
      template: 'confirmEmailChange',
      build: (p: EmailChangeRequestedPayload, ctx: MailContext) => ({
        to: p.newEmail,
        values: { expires: expiresIn(ctx, p.expiresAt) },
        actionUrl: link(ctx, '/account/confirm-email', p.token),
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-email-changed-notice',
      eventType: IdentityEvents.EmailChanged,
      template: 'emailChanged',
      build: (p: EmailChangedPayload) => ({
        to: p.oldEmail,
        values: { oldEmail: p.oldEmail, newEmail: p.newEmail },
        markup: { oldEmail: 'bold' as const, newEmail: 'bold' as const },
      }),
    },
  ],
  dropPushOn: [
    {
      name: 'notification.drop-push-on-session-revoked',
      eventType: IdentityEvents.SessionRevoked,
      session: (p: SessionRevokedPayload) => ({ userId: p.userId, sessionId: p.sessionId }),
    },
  ],
  messages: { en, vi },
} satisfies NotificationIntegration

/**
 * A language the event carries wins (a magic link is written in the language of the page that asked for it); otherwise
 * the recipient's account decides. A lookup error propagates, so the relay retries instead of writing in the wrong language.
 */
export function identityLocaleResolver(identity: IdentityApi): LocaleResolver {
  const pick = (locale: string | null | undefined): Locale =>
    isLocale(locale) ? locale : DEFAULT_LOCALE
  return {
    async resolve(recipient) {
      if (isLocale(recipient.locale) || !recipient.userId) return pick(recipient.locale)
      const account = await identity.getAccount(recipient.userId)
      return pick(account?.locale)
    },
  }
}
