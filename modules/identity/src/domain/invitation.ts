export const INVITATION_TTL_MS = 14 * 24 * 60 * 60_000
/** Invitations one member may send per day. */
export const INVITATIONS_MAX_PER_DAY = 20
export const INVITATIONS_WINDOW_MS = 24 * 60 * 60_000

/** In `invite` mode, an address a member allowed to create an account. Matched by email: proving it is the sign-up. */
export interface Invitation {
  id: string
  email: string
  /** null when another module or a script invited them. */
  invitedBy: string | null
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export function invitationStatus(invitation: Invitation, now: Date): InvitationStatus {
  if (invitation.acceptedAt) return 'accepted'
  if (invitation.revokedAt) return 'revoked'
  return invitation.expiresAt > now ? 'pending' : 'expired'
}
