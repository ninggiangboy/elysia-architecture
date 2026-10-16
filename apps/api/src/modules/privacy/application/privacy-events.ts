import type { DomainEvent } from '#/shared/domain/domain-event'
import {
  type AccountDeletedPayload,
  type AccountDeletionCancelledPayload,
  type AccountDeletionScheduledPayload,
  type AccountDeletionStalledPayload,
  type AccountErasureProgressedPayload,
  type AccountErasureRequestedPayload,
  type DataExportFailedPayload,
  type DataExportProgressedPayload,
  type DataExportReadyPayload,
  type DataExportRequestedPayload,
  PrivacyEvents,
} from '../contracts'
import type { AccountDeletion } from '../domain/account-deletion'

/** Sent by privacy to itself: the last part is in, build the archive. Not part of the contract. */
export const INTERNAL_EXPORT_COLLECTED = 'privacy.export_collected.v1'

const event = (type: string, userId: string, payload: object, occurredAt: Date): DomainEvent => ({
  type,
  aggregateId: userId,
  payload: { ...payload },
  occurredAt,
})

export const dataExportRequested = (
  p: Omit<DataExportRequestedPayload, 'requestedAt'>,
  now: Date,
) =>
  event(
    PrivacyEvents.DataExportRequested,
    p.userId,
    { ...p, requestedAt: now.toISOString() } satisfies DataExportRequestedPayload,
    now,
  )

export const dataExportProgressed = (p: Omit<DataExportProgressedPayload, 'at'>, now: Date) =>
  event(
    PrivacyEvents.DataExportProgressed,
    p.userId,
    { ...p, at: now.toISOString() } satisfies DataExportProgressedPayload,
    now,
  )

export const exportCollected = (p: { exportId: string; userId: string }, now: Date) =>
  event(INTERNAL_EXPORT_COLLECTED, p.userId, p, now)

export const dataExportReady = (p: DataExportReadyPayload, now: Date) =>
  event(PrivacyEvents.DataExportReady, p.userId, p, now)

export const dataExportFailed = (p: Omit<DataExportFailedPayload, 'failedAt'>, now: Date) =>
  event(
    PrivacyEvents.DataExportFailed,
    p.userId,
    { ...p, failedAt: now.toISOString() } satisfies DataExportFailedPayload,
    now,
  )

export const accountDeletionScheduled = (
  p: Omit<AccountDeletionScheduledPayload, 'requestedAt'>,
  now: Date,
) =>
  event(
    PrivacyEvents.AccountDeletionScheduled,
    p.userId,
    { ...p, requestedAt: now.toISOString() } satisfies AccountDeletionScheduledPayload,
    now,
  )

export const accountDeletionCancelled = (
  p: Omit<AccountDeletionCancelledPayload, 'cancelledAt'>,
  now: Date,
) =>
  event(
    PrivacyEvents.AccountDeletionCancelled,
    p.userId,
    { ...p, cancelledAt: now.toISOString() } satisfies AccountDeletionCancelledPayload,
    now,
  )

const accountErasureRequested = (
  p: Omit<AccountErasureRequestedPayload, 'requestedAt'>,
  now: Date,
) =>
  event(
    PrivacyEvents.AccountErasureRequested,
    p.userId,
    { ...p, requestedAt: now.toISOString() } satisfies AccountErasureRequestedPayload,
    now,
  )

/** (Re-)asks the modules that have not confirmed yet; `attempt` counts the re-sends. */
export const erasureRequestFor = (deletion: AccountDeletion, now: Date) =>
  accountErasureRequested(
    {
      deletionId: deletion.id,
      userId: deletion.userId,
      modules: deletion.pendingModules(),
      attempt: deletion.props.nudges,
    },
    now,
  )

export const accountErasureProgressed = (
  p: Omit<AccountErasureProgressedPayload, 'at'>,
  now: Date,
) =>
  event(
    PrivacyEvents.AccountErasureProgressed,
    p.userId,
    { ...p, at: now.toISOString() } satisfies AccountErasureProgressedPayload,
    now,
  )

export const accountDeletionStalled = (
  p: Omit<AccountDeletionStalledPayload, 'stalledAt'>,
  now: Date,
) =>
  event(
    PrivacyEvents.AccountDeletionStalled,
    p.userId,
    { ...p, stalledAt: now.toISOString() } satisfies AccountDeletionStalledPayload,
    now,
  )

export const accountDeleted = (p: Omit<AccountDeletedPayload, 'deletedAt'>, now: Date) =>
  event(
    PrivacyEvents.AccountDeleted,
    p.userId,
    { ...p, deletedAt: now.toISOString() } satisfies AccountDeletedPayload,
    now,
  )
