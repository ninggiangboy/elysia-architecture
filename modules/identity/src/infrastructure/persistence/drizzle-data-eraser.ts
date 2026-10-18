import type { Database } from '@kit/db'
import { erasePublishedOutbox } from '@kit/messaging'
import type { DataEraser } from '@kit/privacy-participant'
import { eq, sql } from 'drizzle-orm'
import {
  emailChangeRequests,
  invitations,
  magicLinks,
  mfaChallenges,
  oauthAccounts,
  oauthStates,
  outbox,
  passkeys,
  passwordResets,
  recoveryCodes,
  refreshTokens,
  signInFailures,
  signups,
  stepUpCodes,
  totpCredentials,
  users,
  webauthnChallenges,
} from './schema'

/**
 * Removes the user and everything hanging off them. Deleting an absent user is not an error (the job may run twice).
 * No event is emitted for the sessions that disappear: the person asked for this, and a "signed out" notification
 * for a deleted account would be new data about them.
 */
export class DrizzleIdentityDataEraser implements DataEraser {
  constructor(private database: Database) {}

  async erase(userId: string): Promise<void> {
    const db = this.database.executor
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    // Children first (they reference the user).
    await db.delete(emailChangeRequests).where(eq(emailChangeRequests.userId, userId))
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
    await db.delete(passkeys).where(eq(passkeys.userId, userId))
    await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId))
    await db.delete(stepUpCodes).where(eq(stepUpCodes.userId, userId))
    await db.delete(oauthStates).where(eq(oauthStates.userId, userId))
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, userId))
    await db.delete(totpCredentials).where(eq(totpCredentials.userId, userId))
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await db.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId))
    await db.delete(passwordResets).where(eq(passwordResets.userId, userId))
    await db.delete(invitations).where(eq(invitations.invitedBy, userId))
    if (user) {
      await db.delete(magicLinks).where(eq(magicLinks.email, user.email))
      await db.delete(signups).where(eq(signups.email, user.email))
      await db.delete(signInFailures).where(eq(signInFailures.email, user.email))
      await db.delete(invitations).where(eq(invitations.email, user.email))
    }
    await db.delete(users).where(eq(users.id, userId))

    // Published events keep payloads (addresses, tokens) until the relay's retention cleanup; magic-link ones are keyed by e-mail.
    await erasePublishedOutbox(
      this.database,
      outbox,
      userId,
      user ? sql`${outbox.payload} ->> 'email' = ${user.email}` : undefined,
    )
  }
}
