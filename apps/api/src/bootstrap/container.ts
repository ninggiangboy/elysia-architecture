import type { OAuthGateway, WebAuthnService } from '#/modules/identity/application/ports'
import { createIdentityModule } from '#/modules/identity/identity.module'
import type { WebPushSender } from '#/modules/notification/application/ports'
import { WebPushLibrarySender } from '#/modules/notification/infrastructure/web-push-sender'
import { createNotificationModule } from '#/modules/notification/notification.module'
import { createProfileModule } from '#/modules/profile/profile.module'
import { createRealtimeModule } from '#/modules/realtime/realtime.module'
import type { IntegrationEventHandler, Mailer } from '#/shared/application/ports'
import type { Config } from '#/shared/infrastructure/config'
import { Database } from '#/shared/infrastructure/db/database'
import type { Logger } from '#/shared/infrastructure/logger'
import { SmtpMailer } from '#/shared/infrastructure/mail/smtp-mailer'
import { OutboxRelay } from '#/shared/infrastructure/outbox/outbox-relay'
import { S3ObjectStorage } from '#/shared/infrastructure/storage/s3-object-storage'
import { SystemClock, UuidV7Generator } from '#/shared/infrastructure/system'
import { InProcessMessageBus } from '#/shared/messaging/in-process-bus'

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
    url: config.DATABASE_URL,
    poolMax: config.DB_POOL_MAX,
    prepare: config.DB_PREPARE,
  })

  const storage = new S3ObjectStorage({
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  })
  const mailer =
    overrides.mailer ??
    new SmtpMailer(
      {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        requireTls: config.SMTP_REQUIRE_TLS,
        user: config.SMTP_USER,
        password: config.SMTP_PASSWORD,
      },
      config.MAIL_FROM,
    )

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config
  const webPush =
    VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
      ? {
          publicKey: VAPID_PUBLIC_KEY,
          quietWindowMs: config.PUSH_QUIET_WINDOW_SECONDS * 1000,
          sender:
            overrides.webPushSender ??
            new WebPushLibrarySender({
              subject: VAPID_SUBJECT,
              publicKey: VAPID_PUBLIC_KEY,
              privateKey: VAPID_PRIVATE_KEY,
            }),
        }
      : undefined

  const identity = await createIdentityModule({
    database,
    config,
    clock,
    ids,
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
    webAppUrl: config.WEB_APP_URL,
    clock,
    ids,
    log: logger,
    verifier: identity.verifier,
    sending: {
      ratePerSecond: config.MAIL_RATE_PER_SECOND,
      burst: config.MAIL_BURST,
      dailyQuota: config.MAIL_DAILY_QUOTA,
    },
    webPush,
  })

  const realtime = createRealtimeModule({
    database,
    clock,
    log: logger,
    verifier: identity.verifier,
    replayWindowMs: config.REALTIME_REPLAY_WINDOW_SECONDS * 1000,
  })

  const bus = new InProcessMessageBus(logger)
  const handlers: IntegrationEventHandler[] = [
    ...profile.handlers,
    ...notification.handlers,
    ...realtime.handlers,
  ]
  for (const handler of handlers) bus.subscribe(handler)

  const relay = new OutboxRelay(
    database,
    [identity.outbox, profile.outbox, notification.outbox],
    bus,
    logger,
    {
      pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
      batchSize: config.OUTBOX_BATCH_SIZE,
      concurrency: Math.min(config.OUTBOX_CONCURRENCY, Math.max(1, config.DB_POOL_MAX - 2)),
      leaseSeconds: config.OUTBOX_LEASE_SECONDS,
      deferBudgetMs: config.OUTBOX_DEFER_BUDGET_HOURS * 3600_000,
    },
  )

  return {
    config,
    logger,
    clock,
    ids,
    storage,
    modules: { identity, profile, notification, realtime },
    database,
    bus,
    relay,
    async close() {
      await relay.stop()
      await realtime.stop()
      await database.close()
    },
  }
}

export type Container = Awaited<ReturnType<typeof createContainer>>
