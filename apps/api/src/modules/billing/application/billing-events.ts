import type { DomainEvent } from '#/shared/domain/domain-event'
import {
  BillingEvents,
  type TopUpFailedPayload,
  type TopUpSucceededPayload,
} from '../contracts/events'

export const topUpSucceeded = (
  p: Omit<TopUpSucceededPayload, 'succeededAt'>,
  at: Date,
): DomainEvent => ({
  type: BillingEvents.TopUpSucceeded,
  aggregateId: p.userId,
  payload: {
    ...p,
    succeededAt: at.toISOString(),
  } satisfies TopUpSucceededPayload as unknown as Record<string, unknown>,
  occurredAt: at,
})

export const topUpFailed = (p: Omit<TopUpFailedPayload, 'failedAt'>, at: Date): DomainEvent => ({
  type: BillingEvents.TopUpFailed,
  aggregateId: p.userId,
  payload: { ...p, failedAt: at.toISOString() } satisfies TopUpFailedPayload as unknown as Record<
    string,
    unknown
  >,
  occurredAt: at,
})
