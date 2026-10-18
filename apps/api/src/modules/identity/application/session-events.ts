import type { DomainEvent } from '#/shared/core'
import {
  IdentityEvents,
  type SessionRevokedPayload,
  type SessionRevokedReason,
  type SessionStartedPayload,
} from '../contracts/events'

export function sessionStarted(
  p: Omit<SessionStartedPayload, 'startedAt'>,
  now: Date,
): DomainEvent {
  const payload: SessionStartedPayload = { ...p, startedAt: now.toISOString() }
  return {
    type: IdentityEvents.SessionStarted,
    aggregateId: p.userId,
    payload: { ...payload },
    occurredAt: now,
  }
}

export function sessionRevoked(
  p: { userId: string; sessionId: string; reason: SessionRevokedReason },
  now: Date,
): DomainEvent {
  const payload: SessionRevokedPayload = { ...p, revokedAt: now.toISOString() }
  return {
    type: IdentityEvents.SessionRevoked,
    aggregateId: p.userId,
    payload: { ...payload },
    occurredAt: now,
  }
}
