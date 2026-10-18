import { BillingEvents, type TopUpSucceededPayload } from '#/modules/billing/contracts'
import {
  type EmailChangedPayload,
  type EmailChangeRequestedPayload,
  type IdentityApi,
  IdentityEvents,
  type MagicLinkRequestedPayload,
  type OAuthAccountLinkedPayload,
  type OAuthAccountUnlinkedPayload,
  type PasskeyAddedPayload,
  type PasskeyRemovedPayload,
  type SessionRevokedPayload,
  type SessionStartedPayload,
  type StepUpCodeRequestedPayload,
  type UserRegisteredPayload,
} from '#/modules/identity/contracts'
import {
  type AccountDeletedPayload,
  type AccountDeletionCancelledPayload,
  type AccountDeletionScheduledPayload,
  type AccountErasureRequestedPayload,
  type DataExportFailedPayload,
  type DataExportReadyPayload,
  type DataExportRequestedPayload,
  PrivacyEvents,
} from '#/modules/privacy/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  Mailer,
  ObjectStorage,
} from '#/shared/application/ports'
import { EraseUserDataHandler, ExportUserDataHandler } from '#/shared/application/privacy'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import type { AppModule } from '#/shared/module/app-module'
import { intervalJobs } from '#/shared/module/interval-jobs'
import { CreateNotificationHandler } from './application/handlers/create-notification-handler'
import { DropPushSubscriptionsHandler } from './application/handlers/drop-push-subscriptions-handler'
import { MailEventHandler } from './application/handlers/mail-event-handler'
import { WebPushHandler } from './application/handlers/web-push-handler'
import {
  accountDeletionCancelledNotification,
  accountDeletionScheduledNotification,
  dataExportFailedNotification,
  dataExportReadyNotification,
  emailChangedNotification,
  type NotificationDraft,
  newSignInNotification,
  oauthLinkedNotification,
  oauthUnlinkedNotification,
  passkeyAddedNotification,
  passkeyRemovedNotification,
  suspiciousSessionNotification,
  topUpSucceededNotification,
  welcomeNotification,
} from './application/in-app-notifications'
import { NotificationDataExporter } from './application/notification-data-exporter'
import type { WebPushSender } from './application/ports'
import { PruneOldNotifications, type RetentionPolicy } from './application/prune-notifications'
import {
  accountDeletedMail,
  accountDeletionCancelledMail,
  accountDeletionScheduledMail,
  confirmEmailChangeMail,
  dataExportReadyMail,
  emailChangedNoticeMail,
  magicLinkMail,
  stepUpCodeMail,
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
import { NotificationEvents } from './contracts/events'
import { IdentityLocaleResolver } from './infrastructure/identity-locale-resolver'
import { DrizzleNotificationDataEraser } from './infrastructure/persistence/drizzle-data-eraser'
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
  /** Where the data export is written. */
  storage: ObjectStorage
  verifier: TokenVerifier
  /** Whose language a message is written in, when the event itself does not say. */
  identity: IdentityApi
  sending: { ratePerSecond: number; burst?: number; dailyQuota: number }
  /** Omit to run without Web Push: the routes report no public key and no handler is registered. */
  webPush?: { sender: WebPushSender; publicKey: string; quietWindowMs?: number }
  retention: RetentionPolicy & {
    /** How often the timer behind `jobs` looks for notifications past the retention. */
    intervalMs: number
  }
}

export interface NotificationModule
  extends AppModule<'notification', ReturnType<typeof notificationRoutes>> {
  routes: ReturnType<typeof notificationRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  /** One retention pass. Runs on a timer (`jobs`); exposed for tests and operators. */
  prune(): Promise<number>
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
  storage,
  verifier,
  identity,
  sending,
  webPush,
  retention,
}: NotificationModuleDeps): NotificationModule {
  const guard = new DrizzleInboxGuard(database, inbox)
  const locales = new IdentityLocaleResolver(identity)
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
  const pruner = new PruneOldNotifications(notifications, retention, clock, log)
  // SKIP LOCKED keeps two instances that tick together apart.
  const jobs = intervalJobs({
    intervalMs: retention.intervalMs,
    run: () => pruner.runOnce(),
    onError: (err) => log.error({ err }, 'notification retention failed'),
  })
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
    jobs,
    prune: () => pruner.runOnce(),
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
              locales,
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
      inApp<PasskeyAddedPayload>(
        'notification.in-app-passkey-added',
        IdentityEvents.PasskeyAdded,
        passkeyAddedNotification,
      ),
      inApp<PasskeyRemovedPayload>(
        'notification.in-app-passkey-removed',
        IdentityEvents.PasskeyRemoved,
        passkeyRemovedNotification,
      ),
      inApp<OAuthAccountLinkedPayload>(
        'notification.in-app-oauth-linked',
        IdentityEvents.OAuthAccountLinked,
        oauthLinkedNotification,
      ),
      inApp<OAuthAccountUnlinkedPayload>(
        'notification.in-app-oauth-unlinked',
        IdentityEvents.OAuthAccountUnlinked,
        oauthUnlinkedNotification,
      ),
      inApp<DataExportReadyPayload>(
        'notification.in-app-export-ready',
        PrivacyEvents.DataExportReady,
        dataExportReadyNotification,
      ),
      inApp<DataExportFailedPayload>(
        'notification.in-app-export-failed',
        PrivacyEvents.DataExportFailed,
        dataExportFailedNotification,
      ),
      inApp<AccountDeletionScheduledPayload>(
        'notification.in-app-deletion-scheduled',
        PrivacyEvents.AccountDeletionScheduled,
        accountDeletionScheduledNotification,
      ),
      inApp<AccountDeletionCancelledPayload>(
        'notification.in-app-deletion-cancelled',
        PrivacyEvents.AccountDeletionCancelled,
        accountDeletionCancelledNotification,
      ),
      inApp<TopUpSucceededPayload>(
        'notification.in-app-topup-succeeded',
        BillingEvents.TopUpSucceeded,
        topUpSucceededNotification,
      ),
      new MailEventHandler<DataExportReadyPayload>(
        'notification.send-export-ready',
        PrivacyEvents.DataExportReady,
        (p, locale) => ({
          to: p.email,
          content: dataExportReadyMail({ url: p.downloadUrl, expiresAt: p.expiresAt }, locale),
          // A link that no longer works is not worth sending late.
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<AccountDeletionScheduledPayload>(
        'notification.send-deletion-scheduled',
        PrivacyEvents.AccountDeletionScheduled,
        (p, locale) => ({
          to: p.email,
          content: accountDeletionScheduledMail(
            {
              scheduledFor: p.scheduledFor,
              cancelUrl: `${webAppUrl.replace(/\/$/, '')}/privacy`,
            },
            locale,
          ),
          // The grace period is the whole point of this mail: after it, the account is gone.
          expiresAt: p.scheduledFor,
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<AccountDeletionCancelledPayload>(
        'notification.send-deletion-cancelled',
        PrivacyEvents.AccountDeletionCancelled,
        (p, locale) => ({ to: p.email, content: accountDeletionCancelledMail(locale) }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<AccountDeletedPayload>(
        'notification.send-account-deleted',
        PrivacyEvents.AccountDeleted,
        (p, locale) => ({ to: p.email, content: accountDeletedMail({ email: p.email }, locale) }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new ExportUserDataHandler<DataExportRequestedPayload>(
        {
          name: 'notification.export-user-data',
          module: 'notification',
          requestType: PrivacyEvents.DataExportRequested,
          answerType: NotificationEvents.DataExported,
        },
        new NotificationDataExporter(notifications, pushSubscriptions),
        storage,
        outboxWriter,
        guard,
        clock,
      ),
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: 'notification.erase-user-data',
          module: 'notification',
          requestType: PrivacyEvents.AccountErasureRequested,
          answerType: NotificationEvents.UserDataErased,
        },
        new DrizzleNotificationDataEraser(database),
        outboxWriter,
        guard,
        clock,
      ),
      new MailEventHandler<StepUpCodeRequestedPayload>(
        'notification.send-step-up-code',
        IdentityEvents.StepUpCodeRequested,
        (p, locale) => ({
          to: p.email,
          content: stepUpCodeMail(
            { code: p.code, expiresInMinutes: minutesUntil(p.expiresAt) },
            locale,
          ),
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<MagicLinkRequestedPayload>(
        'notification.send-magic-link',
        IdentityEvents.MagicLinkRequested,
        (p, locale) => ({
          to: p.email,
          content: magicLinkMail(
            {
              url: link('/auth/callback', p.token),
              expiresInMinutes: minutesUntil(p.expiresAt),
            },
            locale,
          ),
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<UserRegisteredPayload>(
        'notification.send-welcome',
        IdentityEvents.UserRegistered,
        (p, locale) => ({
          to: p.email,
          content: welcomeMail({ email: p.email, appUrl: webAppUrl }, locale),
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<EmailChangeRequestedPayload>(
        'notification.send-email-change-confirmation',
        IdentityEvents.EmailChangeRequested,
        (p, locale) => ({
          to: p.newEmail,
          content: confirmEmailChangeMail(
            {
              url: link('/account/confirm-email', p.token),
              expiresInMinutes: minutesUntil(p.expiresAt),
            },
            locale,
          ),
          expiresAt: p.expiresAt,
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
      new MailEventHandler<EmailChangedPayload>(
        'notification.send-email-changed-notice',
        IdentityEvents.EmailChanged,
        (p, locale) => ({
          to: p.oldEmail,
          content: emailChangedNoticeMail({ oldEmail: p.oldEmail, newEmail: p.newEmail }, locale),
        }),
        mailer,
        guard,
        clock,
        log,
        locales,
      ),
    ],
  }
}
