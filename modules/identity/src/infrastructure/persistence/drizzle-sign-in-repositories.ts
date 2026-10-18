import { ConflictError, VersionConflictError } from '@kit/core'
import { type Database, isUniqueViolation } from '@kit/db'
import { and, count, desc, eq, gt, gte, isNull, lt, min, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Email } from '../../domain/email'
import type { Invitation } from '../../domain/invitation'
import type { PasswordReset } from '../../domain/password'
import type {
  InvitationRepository,
  MfaChallengeRepository,
  PasswordResetRepository,
  RecoveryCodeRepository,
  SignInFailureRepository,
  SignupRepository,
  ThrottleScope,
  TotpCredentialRepository,
  WindowCount,
} from '../../domain/repositories'
import type { Signup } from '../../domain/signup'
import { type MfaChallenge, TotpCredential } from '../../domain/two-factor'
import type { SecretBox } from '../secret-box'
import {
  invitations,
  mfaChallenges,
  passwordResets,
  recoveryCodes,
  signInFailures,
  signups,
  totpCredentials,
} from './schema'

/** Rows are kept this long after they expire (for debugging), then deleted by the next insert. */
const PRUNE_AFTER_MS = 60 * 60_000

async function windowCount(
  database: Database,
  table: Parameters<ReturnType<Database['executor']['select']>['from']>[0],
  createdAt: PgColumn,
  scope: SQL | undefined,
): Promise<WindowCount> {
  const [row] = await database.executor
    .select({ n: count(), oldest: min(createdAt) })
    .from(table)
    .where(scope)
  return { count: row?.n ?? 0, oldest: (row?.oldest as Date | null) ?? null }
}

export class DrizzleSignupRepository implements SignupRepository {
  constructor(private database: Database) {}

  async add(signup: Signup): Promise<void> {
    const ex = this.database.executor
    await ex
      .delete(signups)
      .where(lt(signups.expiresAt, new Date(signup.createdAt.getTime() - PRUNE_AFTER_MS)))
    await ex.insert(signups).values({
      id: signup.id,
      email: signup.email,
      tokenHash: signup.tokenHash,
      codeHash: signup.codeHash,
      emailProvenAt: signup.emailProvenAt,
      method: signup.method,
      passwordHash: signup.passwordHash,
      displayName: signup.displayName,
      termsVersion: signup.termsVersion,
      locale: signup.locale,
      oauthProvider: signup.oauth?.provider ?? null,
      oauthProviderUserId: signup.oauth?.providerUserId ?? null,
      oauthEmail: signup.oauth?.email ?? null,
      requestedIp: signup.requestedIp,
      createdAt: signup.createdAt,
      expiresAt: signup.expiresAt,
    })
  }

  async consume(tokenHash: string, now: Date): Promise<Signup | null> {
    const [row] = await this.database.executor
      .update(signups)
      .set({ consumedAt: now })
      .where(
        and(
          eq(signups.tokenHash, tokenHash),
          isNull(signups.consumedAt),
          gt(signups.expiresAt, now),
        ),
      )
      .returning()
    return row ? toSignup(row) : null
  }

  async consumeByCode(
    email: Email,
    codeHash: string,
    now: Date,
    maxAttempts: number,
  ): Promise<Signup | null> {
    const ex = this.database.executor
    const live = and(
      eq(signups.email, email.value),
      isNull(signups.consumedAt),
      isNull(signups.emailProvenAt),
      gt(signups.expiresAt, now),
      lt(signups.attempts, maxAttempts),
    )
    const [row] = await ex
      .update(signups)
      .set({ consumedAt: now })
      .where(and(live, eq(signups.codeHash, codeHash)))
      .returning()
    if (row) return toSignup(row)
    await ex
      .update(signups)
      .set({ attempts: sql`${signups.attempts} + 1` })
      .where(live)
    return null
  }

  startedSince(scope: ThrottleScope, since: Date): Promise<WindowCount> {
    const who =
      'email' in scope ? eq(signups.email, scope.email) : eq(signups.requestedIp, scope.ip)
    return windowCount(
      this.database,
      signups,
      signups.createdAt,
      and(who, isNull(signups.emailProvenAt), gte(signups.createdAt, since)),
    )
  }
}

function toSignup(row: typeof signups.$inferSelect): Signup {
  return {
    id: row.id,
    email: row.email,
    tokenHash: row.tokenHash,
    codeHash: row.codeHash,
    emailProvenAt: row.emailProvenAt,
    method: row.method,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    termsVersion: row.termsVersion,
    locale: row.locale,
    oauth:
      row.oauthProvider && row.oauthProviderUserId
        ? {
            provider: row.oauthProvider,
            providerUserId: row.oauthProviderUserId,
            email: row.oauthEmail,
          }
        : null,
    requestedIp: row.requestedIp,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}

export class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(private database: Database) {}

  async issue(reset: PasswordReset): Promise<void> {
    const ex = this.database.executor
    await ex
      .update(passwordResets)
      .set({ consumedAt: reset.createdAt })
      .where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.consumedAt)))
    await ex.insert(passwordResets).values(reset)
  }

  async consume(tokenHash: string, now: Date): Promise<PasswordReset | null> {
    const [row] = await this.database.executor
      .update(passwordResets)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.consumedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .returning()
    if (!row) return null
    return {
      id: row.id,
      userId: row.userId,
      email: row.email,
      tokenHash: row.tokenHash,
      requestedIp: row.requestedIp,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }
  }

  requestedSince(scope: ThrottleScope, since: Date): Promise<WindowCount> {
    const who =
      'email' in scope
        ? eq(passwordResets.email, scope.email)
        : eq(passwordResets.requestedIp, scope.ip)
    return windowCount(
      this.database,
      passwordResets,
      passwordResets.createdAt,
      and(who, gte(passwordResets.createdAt, since)),
    )
  }
}

export class DrizzleSignInFailureRepository implements SignInFailureRepository {
  constructor(private database: Database) {}

  async record(failure: {
    id: string
    email: string
    ip: string
    method: string
    at: Date
  }): Promise<void> {
    const ex = this.database.executor
    // Only the last window matters; older rows go as new ones arrive.
    await ex
      .delete(signInFailures)
      .where(lt(signInFailures.createdAt, new Date(failure.at.getTime() - 24 * PRUNE_AFTER_MS)))
    await ex.insert(signInFailures).values({
      id: failure.id,
      email: failure.email,
      ip: failure.ip,
      method: failure.method,
      createdAt: failure.at,
    })
  }

  since(scope: ThrottleScope, since: Date): Promise<WindowCount> {
    const who =
      'email' in scope ? eq(signInFailures.email, scope.email) : eq(signInFailures.ip, scope.ip)
    return windowCount(
      this.database,
      signInFailures,
      signInFailures.createdAt,
      and(who, gte(signInFailures.createdAt, since)),
    )
  }
}

export class DrizzleTotpCredentialRepository implements TotpCredentialRepository {
  constructor(
    private database: Database,
    private box: SecretBox,
  ) {}

  async find(userId: string): Promise<TotpCredential | null> {
    const [row] = await this.database.executor
      .select()
      .from(totpCredentials)
      .where(eq(totpCredentials.userId, userId))
      .limit(1)
    if (!row) return null
    return new TotpCredential(
      row.userId,
      this.box.open(row.secretCiphertext),
      row.confirmedAt,
      row.lastUsedStep,
      row.version,
      row.createdAt,
    )
  }

  async savePending(credential: TotpCredential): Promise<void> {
    const ex = this.database.executor
    const values = {
      userId: credential.userId,
      secretCiphertext: this.box.seal(credential.secret),
      confirmedAt: null,
      lastUsedStep: null,
      version: 1,
      createdAt: credential.createdAt,
    }
    // Upsert only over a pending row: a confirmed authenticator is replaced by disabling it first.
    const rows = await ex
      .insert(totpCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: totpCredentials.userId,
        set: values,
        setWhere: isNull(totpCredentials.confirmedAt),
      })
      .returning({ userId: totpCredentials.userId })
    if (rows.length === 0) {
      throw new ConflictError('totp_already_enabled', 'Two-factor authentication is already on')
    }
    credential.version = 1
  }

  async saveUse(credential: TotpCredential): Promise<void> {
    const updated = await this.database.executor
      .update(totpCredentials)
      .set({
        confirmedAt: credential.confirmedAt,
        lastUsedStep: credential.lastUsedStep,
        version: credential.version + 1,
      })
      .where(
        and(
          eq(totpCredentials.userId, credential.userId),
          eq(totpCredentials.version, credential.version),
        ),
      )
      .returning({ userId: totpCredentials.userId })
    // Two requests with the same code racing: only one may use it.
    if (updated.length === 0) throw new VersionConflictError()
    credential.version += 1
  }

  async remove(userId: string): Promise<boolean> {
    const rows = await this.database.executor
      .delete(totpCredentials)
      .where(eq(totpCredentials.userId, userId))
      .returning({ userId: totpCredentials.userId })
    return rows.length > 0
  }
}

export class DrizzleRecoveryCodeRepository implements RecoveryCodeRepository {
  constructor(
    private database: Database,
    private ids: () => string,
  ) {}

  async replace(userId: string, codeHashes: string[], now: Date): Promise<void> {
    const ex = this.database.executor
    await ex.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await ex
      .insert(recoveryCodes)
      .values(codeHashes.map((codeHash) => ({ id: this.ids(), userId, codeHash, createdAt: now })))
  }

  async consume(userId: string, codeHash: string, now: Date): Promise<boolean> {
    const rows = await this.database.executor
      .update(recoveryCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(recoveryCodes.userId, userId),
          eq(recoveryCodes.codeHash, codeHash),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id })
    return rows.length > 0
  }

  async remaining(userId: string): Promise<number> {
    const [row] = await this.database.executor
      .select({ n: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    return row?.n ?? 0
  }

  async removeAll(userId: string): Promise<void> {
    await this.database.executor.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
  }
}

export class DrizzleMfaChallengeRepository implements MfaChallengeRepository {
  constructor(private database: Database) {}

  async add(challenge: MfaChallenge): Promise<void> {
    const ex = this.database.executor
    await ex
      .delete(mfaChallenges)
      .where(lt(mfaChallenges.expiresAt, new Date(challenge.createdAt.getTime() - PRUNE_AFTER_MS)))
    await ex.insert(mfaChallenges).values(challenge)
  }

  async findLive(tokenHash: string, now: Date, maxAttempts: number): Promise<MfaChallenge | null> {
    const [row] = await this.database.executor
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.tokenHash, tokenHash),
          isNull(mfaChallenges.consumedAt),
          gt(mfaChallenges.expiresAt, now),
          lt(mfaChallenges.attempts, maxAttempts),
        ),
      )
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      tokenHash: row.tokenHash,
      userId: row.userId,
      method: row.method,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }
  }

  async recordFailure(id: string): Promise<void> {
    await this.database.executor
      .update(mfaChallenges)
      .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
      .where(eq(mfaChallenges.id, id))
  }

  async consume(id: string, now: Date): Promise<boolean> {
    const rows = await this.database.executor
      .update(mfaChallenges)
      .set({ consumedAt: now })
      .where(and(eq(mfaChallenges.id, id), isNull(mfaChallenges.consumedAt)))
      .returning({ id: mfaChallenges.id })
    return rows.length > 0
  }
}

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private database: Database) {}

  async add(invitation: Invitation): Promise<void> {
    try {
      await this.database.executor.insert(invitations).values(invitation)
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('invitation_exists', 'Already invited')
      throw err
    }
  }

  private pending(email: string, now: Date) {
    return and(
      eq(invitations.email, email),
      isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt),
      gt(invitations.expiresAt, now),
    )
  }

  async hasPending(email: Email, now: Date): Promise<boolean> {
    const rows = await this.database.executor
      .select({ id: invitations.id })
      .from(invitations)
      .where(this.pending(email.value, now))
      .limit(1)
    return rows.length > 0
  }

  async accept(email: Email, now: Date): Promise<void> {
    await this.database.executor
      .update(invitations)
      .set({ acceptedAt: now })
      .where(this.pending(email.value, now))
  }

  async listByInviter(userId: string): Promise<Invitation[]> {
    return this.database.executor
      .select()
      .from(invitations)
      .where(eq(invitations.invitedBy, userId))
      .orderBy(desc(invitations.createdAt))
      .limit(100)
  }

  sentSince(userId: string, since: Date): Promise<WindowCount> {
    return windowCount(
      this.database,
      invitations,
      invitations.createdAt,
      and(eq(invitations.invitedBy, userId), gte(invitations.createdAt, since)),
    )
  }

  async revoke(userId: string, id: string, now: Date): Promise<boolean> {
    const rows = await this.database.executor
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.id, id),
          eq(invitations.invitedBy, userId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id })
    return rows.length > 0
  }
}
