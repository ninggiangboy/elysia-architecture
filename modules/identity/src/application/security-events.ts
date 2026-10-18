import type { DomainEvent } from '@kit/core'
import {
  IdentityEvents,
  type InvitationSentPayload,
  type OAuthAccountUnlinkedPayload,
  type PasskeyRemovedPayload,
  type PasswordResetRequestedPayload,
  type SignupExistingAccountPayload,
  type SignupVerificationRequestedPayload,
  type StepUpCodeRequestedPayload,
  type TwoFactorDisabledPayload,
  type TwoFactorEnabledPayload,
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

export const passwordResetRequested = (p: PasswordResetRequestedPayload, now: Date): DomainEvent =>
  event(IdentityEvents.PasswordResetRequested, p.userId, p, now)

export const signupVerificationRequested = (
  p: SignupVerificationRequestedPayload,
  now: Date,
): DomainEvent =>
  // No account yet, so the event is keyed by the address (the privacy eraser finds it by payload email too).
  event(IdentityEvents.SignupVerificationRequested, p.email, p, now)

export const signupExistingAccount = (
  p: Omit<SignupExistingAccountPayload, 'requestedAt'>,
  now: Date,
): DomainEvent =>
  event(
    IdentityEvents.SignupExistingAccount,
    p.userId,
    { ...p, requestedAt: now.toISOString() },
    now,
  )

export const twoFactorEnabled = (
  p: Omit<TwoFactorEnabledPayload, 'enabledAt'>,
  now: Date,
): DomainEvent =>
  event(IdentityEvents.TwoFactorEnabled, p.userId, { ...p, enabledAt: now.toISOString() }, now)

export const twoFactorDisabled = (
  p: Omit<TwoFactorDisabledPayload, 'disabledAt'>,
  now: Date,
): DomainEvent =>
  event(IdentityEvents.TwoFactorDisabled, p.userId, { ...p, disabledAt: now.toISOString() }, now)

export const invitationSent = (p: InvitationSentPayload, now: Date): DomainEvent =>
  event(IdentityEvents.InvitationSent, p.invitationId, p, now)
