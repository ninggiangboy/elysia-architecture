import type { TokenVerifier } from '@kit/auth'
import type { MailConfig } from '@kit/mail'
import type { ModuleHost } from '@kit/runtime'
import type { WebPushSender } from './application/ports'
import type { NotificationConfig } from './config'
import type { LocaleResolver, NotificationIntegration } from './contracts'
import { WebPushLibrarySender } from './infrastructure/web-push-sender'
import { createNotificationModule } from './notification.module'

export type NotificationHost = ModuleHost<{
  core: { WEB_APP_URL: string }
  mail: MailConfig
  notification: NotificationConfig
}> & {
  modules: { identity: { verifier: TokenVerifier } }
  /** What gets said, per producer module the app installs. Leave one out and its events produce no mail or notification. */
  integrations: readonly NotificationIntegration[]
  /** Which language an account reads, when the event does not say. */
  locales?: LocaleResolver
  /** Replaces the Web Push sender (tests). Needs the VAPID keys in the config to take effect. */
  overrides?: { webPushSender?: WebPushSender }
}

/** Builds the module from what the host app provides. */
export function installNotification(host: NotificationHost) {
  const { config } = host
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config.notification
  const webPush =
    VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
      ? {
          publicKey: VAPID_PUBLIC_KEY,
          sender:
            host.overrides?.webPushSender ??
            new WebPushLibrarySender({
              subject: VAPID_SUBJECT,
              publicKey: VAPID_PUBLIC_KEY,
              privateKey: VAPID_PRIVATE_KEY,
            }),
        }
      : undefined
  return createNotificationModule({
    database: host.database,
    mailer: host.mailer,
    webAppUrl: config.core.WEB_APP_URL,
    clock: host.clock,
    ids: host.ids,
    log: host.logger,
    storage: host.storage,
    verifier: host.modules.identity.verifier,
    locales: host.locales,
    integrations: host.integrations,
    sending: {
      ratePerSecond: config.mail.MAIL_RATE_PER_SECOND,
      burst: config.mail.MAIL_BURST,
      dailyQuota: config.mail.MAIL_DAILY_QUOTA,
    },
    webPush,
    config: config.notification,
  })
}
