import {
  type RealtimeIntegration,
  realtimePurgeRule,
  realtimeRoute,
} from '#/modules/realtime/contracts'
import {
  type AccountDeletedPayload,
  type AccountDeletionCancelledPayload,
  type AccountDeletionScheduledPayload,
  type AccountErasureProgressedPayload,
  type DataExportFailedPayload,
  type DataExportProgressedPayload,
  type DataExportReadyPayload,
  PrivacyEvents,
} from '../contracts'

export const privacyRealtime = {
  routes: [
    // Steps of a long job: a client that was offline for one must still learn how it went, so these replay.
    // They carry progress, never the download link — the replay buffer is stored.
    realtimeRoute<DataExportProgressedPayload>({
      name: 'realtime.push-export-progress',
      eventType: PrivacyEvents.DataExportProgressed,
      map: (p) => ({
        userId: p.userId,
        event: {
          type: 'privacy.export.progress',
          data: { exportId: p.exportId, module: p.module, done: p.done, total: p.total },
          replay: true,
        },
      }),
    }),
    realtimeRoute<DataExportReadyPayload>({
      name: 'realtime.push-export-ready',
      eventType: PrivacyEvents.DataExportReady,
      map: (p) => ({
        userId: p.userId,
        event: {
          type: 'privacy.export.ready',
          data: { exportId: p.exportId, expiresAt: p.expiresAt, size: p.size },
          replay: true,
        },
      }),
    }),
    realtimeRoute<DataExportFailedPayload>({
      name: 'realtime.push-export-failed',
      eventType: PrivacyEvents.DataExportFailed,
      map: (p) => ({
        userId: p.userId,
        event: { type: 'privacy.export.failed', data: { exportId: p.exportId }, replay: true },
      }),
    }),
    realtimeRoute<AccountErasureProgressedPayload>({
      name: 'realtime.push-erasure-progress',
      eventType: PrivacyEvents.AccountErasureProgressed,
      map: (p) => ({
        userId: p.userId,
        event: {
          type: 'privacy.deletion.progress',
          data: { deletionId: p.deletionId, module: p.module, done: p.done, total: p.total },
          replay: true,
        },
      }),
    }),
    // Scheduling and cancelling are "something changed, refetch" for the user's other devices.
    realtimeRoute<AccountDeletionScheduledPayload>({
      name: 'realtime.push-deletion-scheduled',
      eventType: PrivacyEvents.AccountDeletionScheduled,
      map: (p) => ({
        userId: p.userId,
        event: { type: 'privacy.deletion.changed', data: { status: 'scheduled' } },
      }),
    }),
    realtimeRoute<AccountDeletionCancelledPayload>({
      name: 'realtime.push-deletion-cancelled',
      eventType: PrivacyEvents.AccountDeletionCancelled,
      map: (p) => ({
        userId: p.userId,
        event: { type: 'privacy.deletion.changed', data: { status: 'cancelled' } },
      }),
    }),
  ],
  purgeOn: [
    realtimePurgeRule<AccountDeletedPayload>({
      name: 'realtime.purge-erased-user',
      eventType: PrivacyEvents.AccountDeleted,
      userId: (p) => p.userId,
    }),
  ],
} satisfies RealtimeIntegration
