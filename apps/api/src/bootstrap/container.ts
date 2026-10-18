import { SystemClock, UuidV7Generator } from '@kit/core'
import { Database } from '@kit/db'
import { createMailer, type Mailer } from '@kit/mail'
import { InProcessMessageBus, OutboxRelay } from '@kit/messaging'
import type { PrivacyParticipation } from '@kit/privacy-participant'
import type { AppModule } from '@kit/runtime'
import { MaintenanceMode, MaintenanceStore } from '@kit/runtime'
import { createObjectStorage } from '@kit/storage'
import type { Logger } from '@kit/telemetry'
import type { OAuthGateway, WebAuthnService } from '@mod/identity'
import { createIdentityModule } from '@mod/identity'
import {
  identityLocaleResolver,
  identityNotifications,
} from '@mod/identity/integrations/notification'
import { identityRealtime } from '@mod/identity/integrations/realtime'
import type { WebPushSender } from '@mod/notification'
import { createNotificationModule, WebPushLibrarySender } from '@mod/notification'
import { notificationRealtime } from '@mod/notification/integrations/realtime'
import { createPrivacyModule } from '@mod/privacy'
import { privacyNotifications } from '@mod/privacy/integrations/notification'
import { privacyRealtime } from '@mod/privacy/integrations/realtime'
import { createProfileModule } from '@mod/profile'
import { createRealtimeModule } from '@mod/realtime'
import type { Config } from '#/bootstrap/config'
import type { PaymentGateway } from '#/modules/billing/application/ports'
import { createBillingModule } from '#/modules/billing/billing.module'
import { StripePaymentGateway } from '#/modules/billing/infrastructure/stripe-payment-gateway'
import { billingNotifications } from '#/modules/billing/integrations/notification'
import { billingRealtime } from '#/modules/billing/integrations/realtime'

/**
 * Composition root — the ONLY place that knows concrete adapters and how modules are wired together.
 * To split a module into a service: replace `identity.api` with an HTTP client and InProcessMessageBus with a broker;
 * each module's domain/application stays unchanged.
 */
export interface ContainerOverrides {
  /** Replaces the provider mailer (tests, or an SES adapter). The rate limiter is still wrapped around it. */
  mailer?: Mailer
  /** Replaces the Web Push sender (tests). Needs `VAPID_PUBLIC_KEY` in the config to take effect. */
  webPushSender?: WebPushSender
  /** Replaces the WebAuthn relying party (tests drive it with a software authenticator). */
  webauthn?: WebAuthnService
  /** Replaces the Google/GitHub adapter (tests: a fake provider). */
  oauth?: OAuthGateway
  /** Replaces Stripe (tests: a fake provider). Needs the `STRIPE_*` variables in the config to take effect. */
  paymentGateway?: PaymentGateway
  /** Replaces where the maintenance flag is read from (tests: no shared state with other processes on the database). */
  maintenanceStore?: Pick<MaintenanceStore, 'read'>
}

export async function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const clock = new SystemClock()
  const ids = new UuidV7Generator()

  // One pool + one transaction context for all modules; modules differ only by Postgres schema.
  const database = new Database({
    url: config.db.DATABASE_URL,
    poolMax: config.db.DB_POOL_MAX,
    prepare: config.db.DB_PREPARE,
  })

  const smtp = config.mail
  const storage = createObjectStorage(config.storage)
  const mailer = overrides.mailer ?? createMailer(smtp, logger)

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config.notification
  const webPush =
    VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
      ? {
          publicKey: VAPID_PUBLIC_KEY,
          sender:
            overrides.webPushSender ??
            new WebPushLibrarySender({
              subject: VAPID_SUBJECT,
              publicKey: VAPID_PUBLIC_KEY,
              privateKey: VAPID_PRIVATE_KEY,
            }),
        }
      : undefined

  const { STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } = config.billing
  const payments =
    STRIPE_SECRET_KEY && STRIPE_PUBLISHABLE_KEY && STRIPE_WEBHOOK_SECRET
      ? {
          publishableKey: STRIPE_PUBLISHABLE_KEY,
          gateway:
            overrides.paymentGateway ??
            new StripePaymentGateway(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET),
        }
      : undefined

  const identity = await createIdentityModule({
    database,
    config: config.identity,
    clock,
    ids,
    storage,
    webauthn: overrides.webauthn,
    oauth: overrides.oauth,
  })
  const profile = createProfileModule({
    database,
    clock,
    ids,
    storage,
    log: logger,
    identity: identity.api,
    verifier: identity.verifier,
  })
  const notification = createNotificationModule({
    database,
    mailer,
    webAppUrl: config.core.WEB_APP_URL,
    clock,
    ids,
    log: logger,
    storage,
    verifier: identity.verifier,
    // The one thing notification asks identity: which language an account reads.
    locales: identityLocaleResolver(identity.api),
    // What gets said, per producer. Leave one out and its events simply produce no mail or notification.
    integrations: [identityNotifications, privacyNotifications, billingNotifications], // <kit:notification-integrations>
    sending: {
      ratePerSecond: smtp.MAIL_RATE_PER_SECOND,
      burst: smtp.MAIL_BURST,
      dailyQuota: smtp.MAIL_DAILY_QUOTA,
    },
    webPush,
    config: config.notification,
  })

  const billing = createBillingModule({
    database,
    clock,
    ids,
    log: logger,
    storage,
    verifier: identity.verifier,
    identity: identity.api,
    profile: profile.api,
    config: config.billing,
    payments,
  })

  const participants = (job: keyof PrivacyParticipation) =>
    [identity, profile, notification, billing]
      .filter((m) => m.privacy?.[job])
      .map((m) => m.name)
      .sort()

  const privacy = createPrivacyModule({
    database,
    clock,
    ids,
    storage,
    log: logger,
    identity: identity.api,
    verifier: identity.verifier,
    stepUp: identity.stepUp,
    config: config.privacy,
    // Who takes part is what the modules declare (`privacy` on the module). A module that becomes a service stays in
    // these lists and keeps answering with the same two events.
    participants: { exports: participants('exports'), erases: participants('erases') },
  })

  const realtime = createRealtimeModule({
    database,
    clock,
    log: logger,
    verifier: identity.verifier,
    config: config.realtime,
    // What reaches the open tabs: one integration per producer. Leave one out and its events simply stop being pushed.
    integrations: [identityRealtime, privacyRealtime, billingRealtime, notificationRealtime], // <kit:realtime-integrations>
  })

  // Every place that used to name the modules one by one loops over this list instead.
  const modules = { identity, profile, notification, privacy, billing, realtime } as const
  const list: readonly AppModule[] = Object.values(modules)
  const jobs = list.flatMap((m) => (m.jobs ? [m.jobs] : []))
  const docs = list.flatMap((m) => m.docs ?? [])

  const bus = new InProcessMessageBus(logger)
  for (const handler of list.flatMap((m) => m.handlers ?? [])) bus.subscribe(handler)

  const relay = new OutboxRelay(
    database,
    list.flatMap((m) => (m.outbox ? [m.outbox] : [])),
    bus,
    logger,
    {
      pollIntervalMs: config.outbox.OUTBOX_POLL_INTERVAL_MS,
      batchSize: config.outbox.OUTBOX_BATCH_SIZE,
      concurrency: Math.min(
        config.outbox.OUTBOX_CONCURRENCY,
        Math.max(1, config.db.DB_POOL_MAX - 2),
      ),
      leaseSeconds: config.outbox.OUTBOX_LEASE_SECONDS,
      deferBudgetMs: config.outbox.OUTBOX_DEFER_BUDGET_HOURS * 3600_000,
    },
  )

  // Not started here (tests build containers too): `main.ts` reads it once before serving, then polls.
  const maintenance = new MaintenanceMode(
    overrides.maintenanceStore ?? new MaintenanceStore(database),
    logger,
    config.maintenance.MAINTENANCE_POLL_INTERVAL_MS,
  )

  /** Maintenance mode stops everything that starts work on its own: the relay and the timers behind the jobs. */
  const pauseWorker = async () => {
    await relay.pause()
    for (const job of jobs) await job.stop()
  }
  const resumeWorker = () => {
    relay.resume()
    for (const job of jobs) job.start()
  }
  /** Closes what holds the HTTP server open (SSE streams). Idempotent; call it before stopping the server. */
  const closeLive = async () => {
    for (const m of list) await m.close?.()
  }

  return {
    config,
    logger,
    clock,
    ids,
    storage,
    modules,
    /** The API doc sections the modules describe. */
    docs,
    database,
    bus,
    relay,
    maintenance,
    /**
     * Starts what a worker-role process runs: the outbox relay, and the timers behind the modules' jobs.
     * Follows maintenance mode from then on: paused while it is on (right away if it already is), running again when it ends.
     */
    startWorker() {
      if (maintenance.active)
        void relay.pause() // before `start`, so the first batch is not claimed
      else for (const job of jobs) job.start()
      relay.start()
      // One transition at a time: on → off → on in quick succession must not interleave.
      let transition: Promise<unknown> = Promise.resolve()
      maintenance.onChange((active) => {
        transition = transition
          .then(active ? pauseWorker : resumeWorker)
          .catch((err) =>
            logger.error({ err, active }, 'switching the worker for maintenance failed'),
          )
      })
    },
    closeLive,
    async close() {
      maintenance.stop()
      for (const job of [...jobs].reverse()) await job.stop()
      await relay.stop()
      await closeLive()
      await database.close()
    },
  }
}

export type Container = Awaited<ReturnType<typeof createContainer>>
