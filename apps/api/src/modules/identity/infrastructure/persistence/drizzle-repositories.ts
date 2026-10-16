import { and, desc, eq, gt, isNull, min, ne } from 'drizzle-orm'
import { ConflictError, VersionConflictError } from '#/shared/application/errors'
import { type Database, isUniqueViolation } from '#/shared/infrastructure/db/database'
import { Email } from '../../domain/email'
import { EmailChangeRequest } from '../../domain/email-change-request'
import { MagicLink } from '../../domain/magic-link'
import { type DeviceSession, RefreshToken } from '../../domain/refresh-token'
import type {
  EmailChangeRequestRepository,
  MagicLinkRepository,
  RefreshTokenRepository,
  UserRepository,
} from '../../domain/repositories'
import { User } from '../../domain/user'
import { emailChangeRequests, magicLinks, refreshTokens, users } from './schema'

export class DrizzleUserRepository implements UserRepository {
  constructor(private database: Database) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.database.executor.select().from(users).where(eq(users.id, id)).limit(1)
    return row ? toUser(row) : null
  }

  async findByEmail(email: Email): Promise<User | null> {
    const [row] = await this.database.executor
      .select()
      .from(users)
      .where(eq(users.email, email.value))
      .limit(1)
    return row ? toUser(row) : null
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const rows = await this.database.executor
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.value))
      .limit(1)
    return rows.length > 0
  }

  async save(user: User): Promise<void> {
    const ex = this.database.executor
    try {
      if (user.version === 0) {
        await ex.insert(users).values({
          id: user.id,
          email: user.email.value,
          version: 1,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
      } else {
        const updated = await ex
          .update(users)
          .set({ email: user.email.value, updatedAt: user.updatedAt, version: user.version + 1 })
          .where(and(eq(users.id, user.id), eq(users.version, user.version)))
          .returning({ id: users.id })
        if (updated.length === 0) throw new VersionConflictError()
      }
      user.version += 1
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('email_taken', 'This email is already in use')
      throw err
    }
  }
}

function toUser(row: typeof users.$inferSelect): User {
  return User.restore({
    id: row.id,
    version: row.version,
    email: Email.create(row.email),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export class DrizzleMagicLinkRepository implements MagicLinkRepository {
  constructor(private database: Database) {}

  async add(link: MagicLink): Promise<void> {
    await this.database.executor.insert(magicLinks).values({
      id: link.id,
      email: link.email.value,
      tokenHash: link.tokenHash,
      requestedIp: link.requestedIp,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    })
  }

  async consume(tokenHash: string, now: Date): Promise<MagicLink | null> {
    const [row] = await this.database.executor
      .update(magicLinks)
      .set({ consumedAt: now })
      .where(
        and(
          eq(magicLinks.tokenHash, tokenHash),
          isNull(magicLinks.consumedAt),
          gt(magicLinks.expiresAt, now),
        ),
      )
      .returning()
    if (!row) return null
    return MagicLink.restore({
      id: row.id,
      version: 1,
      email: Email.create(row.email),
      tokenHash: row.tokenHash,
      requestedIp: row.requestedIp,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    })
  }
}

export class DrizzleEmailChangeRequestRepository implements EmailChangeRequestRepository {
  constructor(private database: Database) {}

  async add(request: EmailChangeRequest): Promise<void> {
    await this.database.executor.insert(emailChangeRequests).values({
      id: request.id,
      userId: request.userId,
      newEmail: request.newEmail.value,
      tokenHash: request.tokenHash,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    })
  }

  async consume(tokenHash: string, now: Date): Promise<EmailChangeRequest | null> {
    const [row] = await this.database.executor
      .update(emailChangeRequests)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailChangeRequests.tokenHash, tokenHash),
          isNull(emailChangeRequests.consumedAt),
          gt(emailChangeRequests.expiresAt, now),
        ),
      )
      .returning()
    if (!row) return null
    return EmailChangeRequest.restore({
      id: row.id,
      version: 1,
      userId: row.userId,
      newEmail: Email.create(row.newEmail),
      tokenHash: row.tokenHash,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    })
  }
}

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private database: Database) {}

  async add(token: RefreshToken): Promise<void> {
    await this.database.executor.insert(refreshTokens).values({
      id: token.id,
      userId: token.userId,
      familyId: token.familyId,
      tokenHash: token.tokenHash,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      userAgent: token.userAgent,
      ip: token.ip,
    })
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const [row] = await this.database.executor
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
    return row ? toRefreshToken(row) : null
  }

  async consume(
    tokenHash: string,
    replacedById: string | null,
    now: Date,
  ): Promise<RefreshToken | null> {
    const [row] = await this.database.executor
      .update(refreshTokens)
      .set({ revokedAt: now, replacedById })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning()
    return row ? toRefreshToken(row) : null
  }

  async listActiveSessions(userId: string, now: Date): Promise<DeviceSession[]> {
    const ex = this.database.executor
    const started = ex
      .select({
        familyId: refreshTokens.familyId,
        startedAt: min(refreshTokens.createdAt).as('started_at'),
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .groupBy(refreshTokens.familyId)
      .as('started')
    const rows = await ex
      .select({
        id: refreshTokens.familyId,
        userAgent: refreshTokens.userAgent,
        ip: refreshTokens.ip,
        lastActiveAt: refreshTokens.createdAt,
        startedAt: started.startedAt,
      })
      .from(refreshTokens)
      .innerJoin(started, eq(started.familyId, refreshTokens.familyId))
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(refreshTokens.createdAt))
    return rows.map((r) => ({ ...r, startedAt: r.startedAt ?? r.lastActiveAt }))
  }

  async revokeUserSession(userId: string, familyId: string, now: Date): Promise<boolean> {
    const rows = await this.database.executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning({ id: refreshTokens.id })
    return rows.length > 0
  }

  async revokeOtherSessions(userId: string, exceptFamilyId: string, now: Date): Promise<string[]> {
    const rows = await this.database.executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          ne(refreshTokens.familyId, exceptFamilyId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning({ familyId: refreshTokens.familyId })
    return [...new Set(rows.map((r) => r.familyId))]
  }
}

function toRefreshToken(row: typeof refreshTokens.$inferSelect): RefreshToken {
  return new RefreshToken(
    row.id,
    row.userId,
    row.familyId,
    row.tokenHash,
    row.expiresAt,
    row.createdAt,
    row.revokedAt,
    row.replacedById,
    row.userAgent,
    row.ip,
  )
}
