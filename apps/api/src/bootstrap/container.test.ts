import { describe, expect, test } from 'bun:test'
import { createContainer } from '#/bootstrap/container'
import type { WebPushSender } from '#/modules/notification/application/ports'
import { loadConfig } from '#/shared/infrastructure/config'
import { createLogger } from '#/shared/infrastructure/logger'

/**
 * A handler's name is its consumer group, i.e. the key in each module's `inbox` table. Renaming one makes messages
 * that were already handled run again (a second welcome mail), so the list is pinned here and a change must be deliberate.
 */
const HANDLERS = [
  'billing.erase-user-data|privacy.account_erasure_requested.v1',
  'billing.export-user-data|privacy.data_export_requested.v1',
  'identity.erase-user-data|privacy.account_erasure_requested.v1',
  'identity.export-user-data|privacy.data_export_requested.v1',
  'notification.drop-push-on-session-revoked|identity.session_revoked.v1',
  'notification.erase-user-data|privacy.account_erasure_requested.v1',
  'notification.export-user-data|privacy.data_export_requested.v1',
  'notification.in-app-deletion-cancelled|privacy.account_deletion_cancelled.v1',
  'notification.in-app-deletion-scheduled|privacy.account_deletion_scheduled.v1',
  'notification.in-app-email-changed|identity.email_changed.v1',
  'notification.in-app-export-failed|privacy.data_export_failed.v1',
  'notification.in-app-export-ready|privacy.data_export_ready.v1',
  'notification.in-app-new-sign-in|identity.session_started.v1',
  'notification.in-app-oauth-linked|identity.oauth_account_linked.v1',
  'notification.in-app-oauth-unlinked|identity.oauth_account_unlinked.v1',
  'notification.in-app-passkey-added|identity.passkey_added.v1',
  'notification.in-app-passkey-removed|identity.passkey_removed.v1',
  'notification.in-app-suspicious-session|identity.session_revoked.v1',
  'notification.in-app-topup-succeeded|billing.topup_succeeded.v1',
  'notification.in-app-welcome|identity.user_registered.v1',
  'notification.send-account-deleted|privacy.account_deleted.v1',
  'notification.send-deletion-cancelled|privacy.account_deletion_cancelled.v1',
  'notification.send-deletion-scheduled|privacy.account_deletion_scheduled.v1',
  'notification.send-email-change-confirmation|identity.email_change_requested.v1',
  'notification.send-email-changed-notice|identity.email_changed.v1',
  'notification.send-export-ready|privacy.data_export_ready.v1',
  'notification.send-magic-link|identity.magic_link_requested.v1',
  'notification.send-step-up-code|identity.step_up_code_requested.v1',
  'notification.send-welcome|identity.user_registered.v1',
  'notification.web-push|notification.created.v1',
  'privacy.assemble-export|privacy.export_collected.v1',
  'privacy.erase-user-data|privacy.account_erasure_requested.v1',
  'privacy.record-erasure:billing|billing.user_data_erased.v1',
  'privacy.record-erasure:identity|identity.user_data_erased.v1',
  'privacy.record-erasure:notification|notification.user_data_erased.v1',
  'privacy.record-erasure:privacy|privacy.user_data_erased.v1',
  'privacy.record-erasure:profile|profile.user_data_erased.v1',
  'privacy.record-export-part:billing|billing.data_exported.v1',
  'privacy.record-export-part:identity|identity.data_exported.v1',
  'privacy.record-export-part:notification|notification.data_exported.v1',
  'privacy.record-export-part:profile|profile.data_exported.v1',
  'profile.create-on-user-registered|identity.user_registered.v1',
  'profile.delete-old-avatar|profile.avatar_changed.v1',
  'profile.delete-old-cover|profile.cover_changed.v1',
  'profile.erase-user-data|privacy.account_erasure_requested.v1',
  'profile.export-user-data|privacy.data_export_requested.v1',
  'profile.generate-avatar-thumbnails|profile.avatar_changed.v1',
  'realtime.purge-erased-user|privacy.account_deleted.v1',
  'realtime.push-deletion-cancelled|privacy.account_deletion_cancelled.v1',
  'realtime.push-deletion-scheduled|privacy.account_deletion_scheduled.v1',
  'realtime.push-erasure-progress|privacy.account_erasure_progressed.v1',
  'realtime.push-export-failed|privacy.data_export_failed.v1',
  'realtime.push-export-progress|privacy.data_export_progressed.v1',
  'realtime.push-export-ready|privacy.data_export_ready.v1',
  'realtime.push-notification-created|notification.created.v1',
  'realtime.push-notification-read|notification.read.v1',
  'realtime.push-notification-seen|notification.seen.v1',
  'realtime.push-session-revoked|identity.session_revoked.v1',
  'realtime.push-topup-failed|billing.topup_failed.v1',
  'realtime.push-topup-succeeded|billing.topup_succeeded.v1',
]

async function build() {
  const config = loadConfig({
    ...process.env,
    LOG_LEVEL: 'silent',
    // Web Push on, so its two handlers are part of the list whatever the local .env says.
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:ops@example.test',
  })
  return createContainer(config, createLogger('silent'), {
    webPushSender: {} as WebPushSender,
  })
}

describe('container', () => {
  test('subscribes exactly the pinned handlers (names are inbox keys)', async () => {
    const container = await build()
    try {
      const names = Object.values(container.modules)
        .flatMap((m) => ('handlers' in m ? m.handlers : []))
        .map((h) => `${h.name}|${h.eventType}`)
        .sort()
      expect(names).toEqual(HANDLERS)
    } finally {
      await container.close()
    }
  })
})
