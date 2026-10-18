import { SystemClock, UuidV7Generator } from '@kit/core'
import { Database } from '@kit/db'
import { createMailer, type Mailer } from '@kit/mail'
import type { PrivacyParticipation } from '@kit/privacy-participant'
import type { AppModule } from '@kit/runtime'
import { createRuntime, type MaintenanceStore } from '@kit/runtime'
import { createObjectStorage } from '@kit/storage'
import type { Logger } from '@kit/telemetry'
import { installBilling, type PaymentGateway } from '@mod/billing'
import { billingNotifications } from '@mod/billing/integrations/notification'
import { billingRealtime } from '@mod/billing/integrations/realtime'
import { installIdentity, type OAuthGateway, type WebAuthnService } from '@mod/identity'
import {
  identityLocaleResolver,
  identityNotifications,
} from '@mod/identity/integrations/notification'
import { identityRealtime } from '@mod/identity/integrations/realtime'
import { installNotification, type WebPushSender } from '@mod/notification'
import { notificationRealtime } from '@mod/notification/integrations/realtime'
import { installPrivacy } from '@mod/privacy'
import { privacyNotifications } from '@mod/privacy/integrations/notification'
import { privacyRealtime } from '@mod/privacy/integrations/realtime'
import { installProfile } from '@mod/profile'
import { installRealtime } from '@mod/realtime'
import type { Config } from './config'

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
  const storage = createObjectStorage(config.storage)
  const mailer = overrides.mailer ?? createMailer(config.mail, logger)

  /** What every module's `install` gets. */
  const host = { config, logger, clock, ids, database, storage, mailer, overrides }

  /** Modules in install order. A module that needs others takes them from `modules` of its own install call. */
  const installed: AppModule[] = []
  const use = <M extends AppModule>(module: M) => {
    installed.push(module)
    return module
  }

  const identity = use(await installIdentity(host))
  const profile = use(installProfile({ ...host, modules: { identity } }))
  const notification = use(
    installNotification({
      ...host,
      modules: { identity },
      // What gets said, per producer. Leave one out and its events simply produce no mail or notification.
      integrations: [
        identityNotifications,
        privacyNotifications,
        billingNotifications,
        // <kit:notification-integrations>
      ],
      // The one thing notification asks identity: which language an account reads.
      locales: identityLocaleResolver(identity.api),
    }),
  )
  const billing = use(installBilling({ ...host, modules: { identity, profile } }))
  // <kit:install>
  const realtime = use(
    installRealtime({
      ...host,
      modules: { identity },
      // What reaches the open tabs: one integration per producer.
      integrations: [
        identityRealtime,
        privacyRealtime,
        billingRealtime,
        notificationRealtime,
        // <kit:realtime-integrations>
      ],
    }),
  )
  // Installed last: who takes part in its jobs is what the modules above declare (`privacy` on the module).
  const participants = (job: keyof PrivacyParticipation) =>
    installed
      .filter((m) => m.privacy?.[job])
      .map((m) => m.name)
      .sort()
  const privacy = use(
    installPrivacy({
      ...host,
      modules: { identity },
      participants: { exports: participants('exports'), erases: participants('erases') },
    }),
  )
  // <kit:install-late>

  const modules = {
    identity,
    profile,
    notification,
    privacy,
    billing,
    realtime,
    // <kit:modules>
  } as const

  const runtime = createRuntime({
    modules: installed,
    database,
    logger,
    outbox: config.outbox,
    dbPoolMax: config.db.DB_POOL_MAX,
    maintenance: {
      pollIntervalMs: config.maintenance.MAINTENANCE_POLL_INTERVAL_MS,
      store: overrides.maintenanceStore,
    },
  })

  return { config, logger, clock, ids, storage, database, modules, ...runtime }
}

export type Container = Awaited<ReturnType<typeof createContainer>>
