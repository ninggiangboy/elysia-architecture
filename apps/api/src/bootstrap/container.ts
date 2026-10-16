import { createIdentityModule } from '#/modules/identity/identity.module'
import { createNotificationModule } from '#/modules/notification/notification.module'
import { createProfileModule } from '#/modules/profile/profile.module'
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
 * Composition root — nơi DUY NHẤT biết adapter cụ thể và cách nối các module.
 * Tách module thành service: thay `identity.api` bằng HTTP client, thay InProcessMessageBus bằng broker,
 * domain/application của các module không đổi.
 */
export interface ContainerOverrides {
  /** Thay mailer của nhà cung cấp (test, hoặc adapter SES). Bộ giới hạn tốc độ vẫn được bọc bên ngoài. */
  mailer?: Mailer
}

export async function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const clock = new SystemClock()
  const ids = new UuidV7Generator()

  // Một pool + một ngữ cảnh transaction cho mọi module; module chỉ khác nhau ở schema Postgres.
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

  const identity = await createIdentityModule({ database, config, clock, ids })
  const profile = createProfileModule({
    database,
    clock,
    ids,
    storage,
    identity: identity.api,
    verifier: identity.verifier,
  })
  const notification = createNotificationModule({
    database,
    mailer,
    webAppUrl: config.WEB_APP_URL,
    clock,
    log: logger,
    sending: {
      ratePerSecond: config.MAIL_RATE_PER_SECOND,
      burst: config.MAIL_BURST,
      dailyQuota: config.MAIL_DAILY_QUOTA,
    },
  })

  const bus = new InProcessMessageBus(logger)
  const handlers: IntegrationEventHandler[] = [...profile.handlers, ...notification.handlers]
  for (const handler of handlers) bus.subscribe(handler)

  const relay = new OutboxRelay(database, [identity.outbox, profile.outbox], bus, logger, {
    pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    deferBudgetMs: config.OUTBOX_DEFER_BUDGET_HOURS * 3600_000,
  })

  return {
    config,
    logger,
    clock,
    ids,
    storage,
    modules: { identity, profile, notification },
    database,
    bus,
    relay,
    async close() {
      await relay.stop()
      await database.close()
    },
  }
}

export type Container = Awaited<ReturnType<typeof createContainer>>
