import type { RealtimeIntegration } from '@mod/realtime/contracts'
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
    {
      name: 'realtime.push-export-progress',
      eventType: PrivacyEvents.DataExportProgressed,
      map: (p: DataExportProgressedPayload) => ({
        userId: p.userId,
        event: {
          type: 'privacy.export.progress',
          data: { exportId: p.exportId, module: p.module, done: p.done, total: p.total },
          replay: true,
        },
      }),
    },
    {
      name: 'realtime.push-export-ready',
      eventType: PrivacyEvents.DataExportReady,
      map: (p: DataExportReadyPayload) => ({
        userId: p.userId,
        event: {
          type: 'privacy.export.ready',
          data: { exportId: p.exportId, expiresAt: p.expiresAt, size: p.size },
          replay: true,
        },
      }),
    },
    {
      name: 'realtime.push-export-failed',
      eventType: PrivacyEvents.DataExportFailed,
      map: (p: DataExportFailedPayload) => ({
        userId: p.userId,
        event: { type: 'privacy.export.failed', data: { exportId: p.exportId }, replay: true },
      }),
    },
    {
      name: 'realtime.push-erasure-progress',
      eventType: PrivacyEvents.AccountErasureProgressed,
      map: (p: AccountErasureProgressedPayload) => ({
        userId: p.userId,
        event: {
          type: 'privacy.deletion.progress',
          data: { deletionId: p.deletionId, module: p.module, done: p.done, total: p.total },
          replay: true,
        },
      }),
    },
    // Scheduling and cancelling are "something changed, refetch" for the user's other devices.
    {
      name: 'realtime.push-deletion-scheduled',
      eventType: PrivacyEvents.AccountDeletionScheduled,
      map: (p: AccountDeletionScheduledPayload) => ({
        userId: p.userId,
        event: { type: 'privacy.deletion.changed', data: { status: 'scheduled' } },
      }),
    },
    {
      name: 'realtime.push-deletion-cancelled',
      eventType: PrivacyEvents.AccountDeletionCancelled,
      map: (p: AccountDeletionCancelledPayload) => ({
        userId: p.userId,
        event: { type: 'privacy.deletion.changed', data: { status: 'cancelled' } },
      }),
    },
  ],
  purgeOn: [
    {
      name: 'realtime.purge-erased-user',
      eventType: PrivacyEvents.AccountDeleted,
      userId: (p: AccountDeletedPayload) => p.userId,
    },
  ],
} satisfies RealtimeIntegration
