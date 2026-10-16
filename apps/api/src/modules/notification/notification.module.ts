import {
  type EmailChangedPayload,
  type EmailChangeRequestedPayload,
  IdentityEvents,
  type MagicLinkRequestedPayload,
  type UserRegisteredPayload,
} from '#/modules/identity/contracts'
import type { Clock, IntegrationEventHandler, Log, Mailer } from '#/shared/application/ports'
import type { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { MailEventHandler } from './application/handlers/mail-event-handler'
import {
  confirmEmailChangeMail,
  emailChangedNoticeMail,
  magicLinkMail,
  welcomeMail,
} from './application/templates'
import { ThrottledMailer } from './application/throttled-mailer'
import { inbox } from './infrastructure/persistence/schema'
import { PostgresSendRateLimiter } from './infrastructure/postgres-send-rate-limiter'

export interface NotificationModuleDeps {
  mod: ModuleDatabase
  /** Mailer thật (SMTP/SES…). Module tự bọc bộ giới hạn tốc độ quanh nó. */
  mailer: Mailer
  webAppUrl: string
  clock: Clock
  log: Log
  sending: { ratePerSecond: number; burst?: number; dailyQuota: number }
}

export interface NotificationModule {
  name: 'notification'
  mod: ModuleDatabase
  handlers: IntegrationEventHandler[]
}

const minutesUntil = (iso: string) =>
  Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))

export function createNotificationModule({
  mod,
  mailer: providerMailer,
  webAppUrl,
  clock,
  log,
  sending,
}: NotificationModuleDeps): NotificationModule {
  const guard = new DrizzleInboxGuard(mod, inbox)
  const mailer = new ThrottledMailer(
    providerMailer,
    new PostgresSendRateLimiter(mod, {
      ratePerSecond: sending.ratePerSecond,
      burst: sending.burst ?? Math.max(1, Math.ceil(sending.ratePerSecond)),
      dailyQuota: sending.dailyQuota,
    }),
  )
  const link = (path: string, token: string) =>
    `${webAppUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`

  return {
    name: 'notification',
    mod,
    handlers: [
      new MailEventHandler<MagicLinkRequestedPayload>(
        'notification.send-magic-link',
        IdentityEvents.MagicLinkRequested,
        (p) => ({
          to: p.email,
          content: magicLinkMail({
            url: link('/auth/callback', p.token),
            expiresInMinutes: minutesUntil(p.expiresAt),
          }),
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
      ),
      new MailEventHandler<UserRegisteredPayload>(
        'notification.send-welcome',
        IdentityEvents.UserRegistered,
        (p) => ({ to: p.email, content: welcomeMail({ email: p.email, appUrl: webAppUrl }) }),
        mailer,
        guard,
        clock,
        log,
      ),
      new MailEventHandler<EmailChangeRequestedPayload>(
        'notification.send-email-change-confirmation',
        IdentityEvents.EmailChangeRequested,
        (p) => ({
          to: p.newEmail,
          content: confirmEmailChangeMail({
            url: link('/account/confirm-email', p.token),
            expiresInMinutes: minutesUntil(p.expiresAt),
          }),
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
      ),
      new MailEventHandler<EmailChangedPayload>(
        'notification.send-email-changed-notice',
        IdentityEvents.EmailChanged,
        (p) => ({
          to: p.oldEmail,
          content: emailChangedNoticeMail({ oldEmail: p.oldEmail, newEmail: p.newEmail }),
        }),
        mailer,
        guard,
        clock,
        log,
      ),
    ],
  }
}
