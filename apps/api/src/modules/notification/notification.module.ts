import type { Clock, IdGenerator, Log } from '@kit/core'
import type { Database } from '@kit/db'
import type { TokenVerifier } from '#/shared/auth'
import type { Mailer } from '#/shared/mail'
import type { IntegrationEventHandler, OutboxSource } from '#/shared/messaging'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '#/shared/messaging'
import { privacyParticipation } from '#/shared/privacy-participant'
import type { AppModule } from '#/shared/runtime'
import { intervalJobs } from '#/shared/runtime'
import type { ObjectStorage } from '#/shared/storage'
import { CreateNotificationHandler } from './application/handlers/create-notification-handler'
import { DropPushSubscriptionsHandler } from './application/handlers/drop-push-subscriptions-handler'
import { MailEventHandler } from './application/handlers/mail-event-handler'
import { WebPushHandler } from './application/handlers/web-push-handler'
import { composeMail } from './application/mail-composer'
import { createMessages, type MessagesOptions } from './application/messages'
import { NotificationDataExporter } from './application/notification-data-exporter'
import { createNotificationRenderer } from './application/notification-renderer'
import { payloadLocale } from './application/payload-locale'
import type { WebPushSender } from './application/ports'
import { PruneOldNotifications } from './application/prune-notifications'
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
import type { NotificationConfig } from './config'
import type { LocaleResolver, NotificationIntegration, TemplateValues } from './contracts'
import { NotificationEvents } from './contracts/events'
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
  /** Whose language a message is written in, when the event itself does not say. Omit to use the language the event carries. */
  locales?: LocaleResolver
  /** What the module says and to which events: one entry per producer module the app installs. */
  integrations: readonly NotificationIntegration[]
  /** Rewords messages without ejecting the module (the extension point for wording). */
  messageOverrides?: MessagesOptions['overrides']
  sending: { ratePerSecond: number; burst?: number; dailyQuota: number }
  /** Omit to run without Web Push: the routes report no public key and no handler is registered. */
  webPush?: { sender: WebPushSender; publicKey: string }
  config: NotificationConfig
}

export interface NotificationModule
  extends AppModule<'notification', ReturnType<typeof notificationRoutes>> {
  routes: ReturnType<typeof notificationRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  /** One retention pass. Runs on a timer (`jobs`); exposed for tests and operators. */
  prune(): Promise<number>
}

export function createNotificationModule({
  database,
  mailer: providerMailer,
  webAppUrl,
  clock,
  ids,
  log,
  storage,
  verifier,
  locales = payloadLocale,
  integrations,
  messageOverrides,
  sending,
  webPush,
  config,
}: NotificationModuleDeps): NotificationModule {
  const guard = new DrizzleInboxGuard(database, inbox)
  const appUrl = webAppUrl.replace(/\/$/, '')
  const messages = createMessages({ integrations, overrides: messageOverrides })
  const templates = mergeTemplates(integrations)
  const render = createNotificationRenderer(templates, messages.translate)
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
  const participation = privacyParticipation({
    module: 'notification',
    storage,
    outbox: outboxWriter,
    inbox: guard,
    clock,
    export: {
      exporter: new NotificationDataExporter(notifications, pushSubscriptions),
      answerType: NotificationEvents.DataExported,
    },
    erase: {
      eraser: new DrizzleNotificationDataEraser(database),
      answerType: NotificationEvents.UserDataErased,
    },
  })
  const retention = {
    maxAgeMs: config.NOTIFICATION_RETENTION * 1000,
    batchSize: 1000,
    intervalMs: config.NOTIFICATION_PRUNE_INTERVAL_SECONDS * 1000,
  }
  const pruner = new PruneOldNotifications(notifications, retention, clock, log)
  // SKIP LOCKED keeps two instances that tick together apart.
  const jobs = intervalJobs({
    intervalMs: retention.intervalMs,
    run: () => pruner.runOnce(),
    onError: (err) => log.error({ err }, 'notification retention failed'),
  })
  return {
    name: 'notification',
    docs: [
      {
        name: 'notifications',
        description: "The current user's in-app notifications (also pushed live over SSE)",
      },
    ],
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
    privacy: participation.privacy,
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
              render,
              config.PUSH_QUIET_WINDOW_SECONDS * 1000,
              locales,
            ),
            ...integrations
              .flatMap((i) => i.dropPushOn ?? [])
              .map((rule) => new DropPushSubscriptionsHandler(rule, pushSubscriptions)),
          ]
        : []),
      ...integrations
        .flatMap((i) => i.inApp ?? [])
        .map(
          (def) =>
            new CreateNotificationHandler(
              def.name,
              def.eventType,
              def.build,
              notifications,
              outboxWriter,
              guard,
              ids,
              clock,
            ),
        ),
      ...integrations
        .flatMap((i) => i.mails ?? [])
        .map(
          (def) =>
            new MailEventHandler(
              def.name,
              def.eventType,
              (payload, locale) => {
                const t = messages.translate(locale)
                const spec = def.build(payload, { locale, t, webAppUrl: appUrl })
                return {
                  to: spec.to,
                  content: composeMail(t, def.template, spec),
                  expiresAt: spec.expiresAt,
                }
              },
              mailer,
              guard,
              clock,
              log,
              locales,
            ),
        ),
      ...participation.handlers,
    ],
  }
}

/** Two integrations defining the same template is a bug (the last would silently win): fail at startup. */
function mergeTemplates(integrations: readonly NotificationIntegration[]) {
  const merged: Record<string, TemplateValues> = {}
  for (const [name, values] of integrations.flatMap((i) => Object.entries(i.templates ?? {}))) {
    if (Object.hasOwn(merged, name)) throw new Error(`Duplicate notification template: ${name}`)
    merged[name] = values
  }
  return merged
}
