import { and, eq, gt, isNull } from 'drizzle-orm'
import { ConflictError, VersionConflictError } from '#/shared/application/errors'
import { isUniqueViolation, type ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import { Email } from '../../domain/email'
import { EmailChangeRequest } from '../../domain/email-change-request'
import { MagicLink } from '../../domain/magic-link'
import { RefreshToken } from '../../domain/refresh-token'
import type {
  EmailChangeRequestRepository,
  MagicLinkRepository,
  RefreshTokenRepository,
  UserRepository,
} from '../../domain/repositories'
import { User } from '../../domain/user'
import { emailChangeRequests, magicLinks, refreshTokens, users } from './schema'

export class DrizzleUserRepository implements UserRepository {
  constructor(private mod: ModuleDatabase) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.mod.executor.select().from(users).where(eq(users.id, id)).limit(1)
    return row ? toUser(row) : null
  }

  async findByEmail(email: Email): Promise<User | null> {
    const [row] = await this.mod.executor
      .select()
      .from(users)
      .where(eq(users.email, email.value))
      .limit(1)
    return row ? toUser(row) : null
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const rows = await this.mod.executor
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.value))
      .limit(1)
    return rows.length > 0
  }

  async save(user: User): Promise<void> {
    const ex = this.mod.executor
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
  constructor(private mod: ModuleDatabase) {}

  async add(link: MagicLink): Promise<void> {
    await this.mod.executor.insert(magicLinks).values({
      id: link.id,
      email: link.email.value,
      tokenHash: link.tokenHash,
      requestedIp: link.requestedIp,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    })
  }

  async consume(tokenHash: string, now: Date): Promise<MagicLink | null> {
    const [row] = await this.mod.executor
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
  constructor(private mod: ModuleDatabase) {}

  async add(request: EmailChangeRequest): Promise<void> {
    await this.mod.executor.insert(emailChangeRequests).values({
      id: request.id,
      userId: request.userId,
      newEmail: request.newEmail.value,
      tokenHash: request.tokenHash,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    })
  }

  async consume(tokenHash: string, now: Date): Promise<EmailChangeRequest | null> {
    const [row] = await this.mod.executor
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
  constructor(private mod: ModuleDatabase) {}

  async add(token: RefreshToken): Promise<void> {
    await this.mod.executor.insert(refreshTokens).values({
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
    const [row] = await this.mod.executor
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
    const [row] = await this.mod.executor
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

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.mod.executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
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
