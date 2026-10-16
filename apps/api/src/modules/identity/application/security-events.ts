import type { DomainEvent } from '#/shared/domain/domain-event'
import {
  IdentityEvents,
  type OAuthAccountUnlinkedPayload,
  type PasskeyRemovedPayload,
  type StepUpCodeRequestedPayload,
} from '../contracts/events'

const event = (type: string, userId: string, payload: object, occurredAt: Date): DomainEvent => ({
  type,
  aggregateId: userId,
  payload: { ...payload },
  occurredAt,
})

export const passkeyRemoved = (
  p: Omit<PasskeyRemovedPayload, 'removedAt'>,
  now: Date,
): DomainEvent =>
  event(IdentityEvents.PasskeyRemoved, p.userId, { ...p, removedAt: now.toISOString() }, now)

export const oauthAccountUnlinked = (
  p: Omit<OAuthAccountUnlinkedPayload, 'unlinkedAt'>,
  now: Date,
): DomainEvent =>
  event(IdentityEvents.OAuthAccountUnlinked, p.userId, { ...p, unlinkedAt: now.toISOString() }, now)

export const stepUpCodeRequested = (p: StepUpCodeRequestedPayload, now: Date): DomainEvent =>
  event(IdentityEvents.StepUpCodeRequested, p.userId, p, now)
