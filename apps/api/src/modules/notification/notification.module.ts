import {
  type EmailChangedPayload,
  type EmailChangeRequestedPayload,
  IdentityEvents,
  type MagicLinkRequestedPayload,
  type SessionRevokedPayload,
  type SessionStartedPayload,
  type UserRegisteredPayload,
} from '#/modules/identity/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  Mailer,
} from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import { CreateNotificationHandler } from './application/handlers/create-notification-handler'
import { DropPushSubscriptionsHandler } from './application/handlers/drop-push-subscriptions-handler'
import { MailEventHandler } from './application/handlers/mail-event-handler'
import { WebPushHandler } from './application/handlers/web-push-handler'
import {
  emailChangedNotification,
  type NotificationDraft,
  newSignInNotification,
  suspiciousSessionNotification,
  welcomeNotification,
} from './application/in-app-notifications'
import type { WebPushSender } from './application/ports'
import {
  confirmEmailChangeMail,
  emailChangedNoticeMail,
  magicLinkMail,
  welcomeMail,
} from './application/templates'
import { ThrottledMailer } from './application/throttled-mailer'
import {
  MarkAllNotificationsRead,
  MarkNotificationRead,
  MarkNotificationsSeen,
} from './application/use-cases/mark-read'
import { SubscribeToPush, UnsubscribeFromPush } from './application/use-cases/push-subscriptions'
import {
  GetUnreadCount,
  GetUnseenCount,
  ListNotifications,
} from './application/use-cases/read-notifications'
import { DrizzleNotificationRepository } from './infrastructure/persistence/drizzle-notification-repository'
import { DrizzlePushSubscriptionRepository } from './infrastructure/persistence/drizzle-push-subscription-repository'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { PostgresSendRateLimiter } from './infrastructure/postgres-send-rate-limiter'
import { notificationRoutes } from './presentation/routes'

export interface NotificationModuleDeps {
  database: Database
  /** The real mailer (SMTP/SES…). The module wraps the rate limiter around it itself. */
  mailer: Mailer
  webAppUrl: string
  clock: Clock
  ids: IdGenerator
  log: Log
  verifier: TokenVerifier
  sending: { ratePerSecond: number; burst?: number; dailyQuota: number }
  /** Omit to run without Web Push: the routes report no public key and no handler is registered. */
  webPush?: { sender: WebPushSender; publicKey: string; quietWindowMs?: number }
}

export interface NotificationModule {
  name: 'notification'
  routes: ReturnType<typeof notificationRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

const minutesUntil = (iso: string) =>
  Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))

export function createNotificationModule({
  database,
  mailer: providerMailer,
  webAppUrl,
  clock,
  ids,
  log,
  verifier,
  sending,
  webPush,
}: NotificationModuleDeps): NotificationModule {
  const guard = new DrizzleInboxGuard(database, inbox)
  const mailer = new ThrottledMailer(
    providerMailer,
    new PostgresSendRateLimiter(database, {
      ratePerSecond: sending.ratePerSecond,
      burst: sending.burst ?? Math.max(1, Math.ceil(sending.ratePerSecond)),
      dailyQuota: sending.dailyQuota,
    }),
  )
  const notifications = new DrizzleNotificationRepository(database)
  const pushSubscriptions = new DrizzlePushSubscriptionRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inApp = <TPayload>(
    name: string,
    eventType: string,
    build: (payload: TPayload) => NotificationDraft | null,
  ) =>
    new CreateNotificationHandler<TPayload>(
      name,
      eventType,
      build,
      notifications,
      outboxWriter,
      guard,
      ids,
      clock,
    )
  const link = (path: string, token: string) =>
    `${webAppUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`

  return {
    name: 'notification',
    routes: notificationRoutes({
      verifier,
      useCases: {
        listNotifications: new ListNotifications(notifications),
        getUnreadCount: new GetUnreadCount(notifications),
        getUnseenCount: new GetUnseenCount(notifications),
        markSeen: new MarkNotificationsSeen(notifications, outboxWriter, database, clock),
        markRead: new MarkNotificationRead(notifications, outboxWriter, database, clock),
        markAllRead: new MarkAllNotificationsRead(notifications, outboxWriter, database, clock),
        subscribeToPush: new SubscribeToPush(pushSubscriptions, database, ids, clock),
        unsubscribeFromPush: new UnsubscribeFromPush(pushSubscriptions),
      },
      webPushPublicKey: webPush?.publicKey ?? null,
    }),
    outbox: { name: 'notification', table: outbox },
    handlers: [
      ...(webPush
        ? [
            new WebPushHandler(
              pushSubscriptions,
              notifications,
              webPush.sender,
              guard,
              clock,
              log,
              webPush.quietWindowMs,
            ),
            new DropPushSubscriptionsHandler(pushSubscriptions),
          ]
        : []),
      inApp<UserRegisteredPayload>(
        'notification.in-app-welcome',
        IdentityEvents.UserRegistered,
        welcomeNotification,
      ),
      inApp<EmailChangedPayload>(
        'notification.in-app-email-changed',
        IdentityEvents.EmailChanged,
        emailChangedNotification,
      ),
      inApp<SessionStartedPayload>(
        'notification.in-app-new-sign-in',
        IdentityEvents.SessionStarted,
        // The first session of a new account is the sign-up itself — the welcome notification covers it.
        (p) => (p.newUser ? null : newSignInNotification(p)),
      ),
      inApp<SessionRevokedPayload>(
        'notification.in-app-suspicious-session',
        IdentityEvents.SessionRevoked,
        // Logouts and "sign out that device" are the user's own doing — only token theft is news.
        (p) => (p.reason === 'token_reuse' ? suspiciousSessionNotification(p) : null),
      ),
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
