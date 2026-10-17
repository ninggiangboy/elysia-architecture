import { and, asc, count, eq, gt, gte, isNull, lt, min, sql } from 'drizzle-orm'
import { ConflictError, VersionConflictError } from '#/shared/application/errors'
import { type Database, isUniqueViolation } from '#/shared/infrastructure/db/database'
import type { OAuthState, WebAuthnChallenge, WebAuthnPurpose } from '../../domain/auth-challenge'
import { OAuthAccount, type OAuthProviderId } from '../../domain/oauth-account'
import { Passkey, type PasskeyDeviceType } from '../../domain/passkey'
import type {
  OAuthAccountRepository,
  OAuthStateRepository,
  PasskeyRepository,
  StepUpCodeRepository,
  WebAuthnChallengeRepository,
} from '../../domain/repositories'
import type { StepUpCode } from '../../domain/step-up-code'
import { oauthAccounts, oauthStates, passkeys, stepUpCodes, webauthnChallenges } from './schema'

/** Rows are kept this long after they expire (for debugging), then deleted by the next insert. */
const PRUNE_AFTER_MS = 60 * 60_000

export class DrizzlePasskeyRepository implements PasskeyRepository {
  constructor(private database: Database) {}

  async add(passkey: Passkey): Promise<void> {
    try {
      await this.database.executor.insert(passkeys).values({
        id: passkey.id,
        userId: passkey.userId,
        version: 1,
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        name: passkey.name,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
      })
      passkey.version = 1
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('passkey_exists', 'This passkey is already registered')
      }
      throw err
    }
  }

  async findByCredentialId(credentialId: string): Promise<Passkey | null> {
    const [row] = await this.database.executor
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credentialId))
      .limit(1)
    return row ? toPasskey(row) : null
  }

  async findByUserAndId(userId: string, id: string): Promise<Passkey | null> {
    const [row] = await this.database.executor
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .limit(1)
    return row ? toPasskey(row) : null
  }

  async listByUser(userId: string): Promise<Passkey[]> {
    const rows = await this.database.executor
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt))
    return rows.map(toPasskey)
  }

  async saveUse(passkey: Passkey): Promise<void> {
    const updated = await this.database.executor
      .update(passkeys)
      .set({
        counter: passkey.counter,
        backedUp: passkey.backedUp,
        lastUsedAt: passkey.lastUsedAt,
        version: passkey.version + 1,
      })
      .where(and(eq(passkeys.id, passkey.id), eq(passkeys.version, passkey.version)))
      .returning({ id: passkeys.id })
    // Two assertions with the same counter racing: only one may move it forward.
    if (updated.length === 0) throw new VersionConflictError()
    passkey.version += 1
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const removed = await this.database.executor
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning({ id: passkeys.id })
    return removed.length > 0
  }
}

function toPasskey(row: typeof passkeys.$inferSelect): Passkey {
  return Passkey.restore({
    id: row.id,
    version: row.version,
    userId: row.userId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports,
    deviceType: row.deviceType as PasskeyDeviceType,
    backedUp: row.backedUp,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  })
}

export class DrizzleWebAuthnChallengeRepository implements WebAuthnChallengeRepository {
  constructor(private database: Database) {}

  async add(challenge: WebAuthnChallenge): Promise<void> {
    const ex = this.database.executor
    // Anyone can ask for sign-in options, so expired rows are cleaned up as new ones arrive.
    await ex
      .delete(webauthnChallenges)
      .where(
        lt(webauthnChallenges.expiresAt, new Date(challenge.createdAt.getTime() - PRUNE_AFTER_MS)),
      )
    await ex.insert(webauthnChallenges).values(challenge)
  }

  async consume(
    id: string,
    purpose: WebAuthnPurpose,
    now: Date,
  ): Promise<WebAuthnChallenge | null> {
    const [row] = await this.database.executor
      .update(webauthnChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(webauthnChallenges.id, id),
          eq(webauthnChallenges.purpose, purpose),
          isNull(webauthnChallenges.consumedAt),
          gt(webauthnChallenges.expiresAt, now),
        ),
      )
      .returning()
    if (!row) return null
    return {
      id: row.id,
      challenge: row.challenge,
      purpose: row.purpose as WebAuthnPurpose,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }
  }
}

export class DrizzleOAuthAccountRepository implements OAuthAccountRepository {
  constructor(private database: Database) {}

  async add(account: OAuthAccount): Promise<void> {
    try {
      await this.database.executor.insert(oauthAccounts).values({
        id: account.id,
        userId: account.userId,
        provider: account.provider,
        providerUserId: account.providerUserId,
        email: account.email,
        createdAt: account.createdAt,
      })
      account.version = 1
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('oauth_account_taken', 'That account is already connected')
      }
      throw err
    }
  }

  async findByProviderUser(
    provider: OAuthProviderId,
    providerUserId: string,
  ): Promise<OAuthAccount | null> {
    const [row] = await this.database.executor
      .select()
      .from(oauthAccounts)
      .where(
        and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)),
      )
      .limit(1)
    return row ? toOAuthAccount(row) : null
  }

  async listByUser(userId: string): Promise<OAuthAccount[]> {
    const rows = await this.database.executor
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .orderBy(asc(oauthAccounts.createdAt))
    return rows.map(toOAuthAccount)
  }

  async remove(userId: string, provider: OAuthProviderId): Promise<boolean> {
    const removed = await this.database.executor
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))
      .returning({ id: oauthAccounts.id })
    return removed.length > 0
  }
}

function toOAuthAccount(row: typeof oauthAccounts.$inferSelect): OAuthAccount {
  return OAuthAccount.restore({
    id: row.id,
    userId: row.userId,
    provider: row.provider as OAuthProviderId,
    providerUserId: row.providerUserId,
    email: row.email,
    createdAt: row.createdAt,
  })
}

export class DrizzleOAuthStateRepository implements OAuthStateRepository {
  constructor(private database: Database) {}

  async add(state: OAuthState): Promise<void> {
    const ex = this.database.executor
    await ex
      .delete(oauthStates)
      .where(lt(oauthStates.expiresAt, new Date(state.createdAt.getTime() - PRUNE_AFTER_MS)))
    await ex.insert(oauthStates).values(state)
  }

  async consume(stateHash: string, now: Date): Promise<OAuthState | null> {
    const [row] = await this.database.executor
      .update(oauthStates)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oauthStates.stateHash, stateHash),
          isNull(oauthStates.consumedAt),
          gt(oauthStates.expiresAt, now),
        ),
      )
      .returning()
    if (!row) return null
    return {
      id: row.id,
      stateHash: row.stateHash,
      provider: row.provider,
      codeVerifier: row.codeVerifier,
      purpose: row.purpose as OAuthState['purpose'],
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }
  }
}

export class DrizzleStepUpCodeRepository implements StepUpCodeRepository {
  constructor(private database: Database) {}

  async issue(code: StepUpCode): Promise<void> {
    const ex = this.database.executor
    await ex
      .update(stepUpCodes)
      .set({ consumedAt: code.createdAt })
      .where(and(eq(stepUpCodes.userId, code.userId), isNull(stepUpCodes.consumedAt)))
    await ex.insert(stepUpCodes).values(code)
  }

  async issuedSince(userId: string, since: Date): Promise<{ count: number; oldest: Date | null }> {
    const [row] = await this.database.executor
      .select({ n: count(), oldest: min(stepUpCodes.createdAt) })
      .from(stepUpCodes)
      .where(and(eq(stepUpCodes.userId, userId), gte(stepUpCodes.createdAt, since)))
    return { count: row?.n ?? 0, oldest: row?.oldest ?? null }
  }

  async verify(userId: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean> {
    const ex = this.database.executor
    const live = and(
      eq(stepUpCodes.userId, userId),
      isNull(stepUpCodes.consumedAt),
      gt(stepUpCodes.expiresAt, now),
      lt(stepUpCodes.attempts, maxAttempts),
    )
    const [hit] = await ex
      .update(stepUpCodes)
      .set({ consumedAt: now })
      .where(and(live, eq(stepUpCodes.codeHash, codeHash)))
      .returning({ id: stepUpCodes.id })
    if (hit) return true
    await ex
      .update(stepUpCodes)
      .set({ attempts: sql`${stepUpCodes.attempts} + 1` })
      .where(live)
    return false
  }
}
