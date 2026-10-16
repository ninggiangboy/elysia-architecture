import { and, eq } from 'drizzle-orm'
import { ConflictError, VersionConflictError } from '#/shared/application/errors'
import { isUniqueViolation, type ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import { Profile } from '../../domain/profile'
import type { ProfileRepository } from '../../domain/profile-repository'
import { profiles } from './schema'

export class DrizzleProfileRepository implements ProfileRepository {
  constructor(private mod: ModuleDatabase) {}

  async findByUserId(userId: string): Promise<Profile | null> {
    const [row] = await this.mod.executor
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
    if (!row) return null
    return Profile.restore({
      userId: row.userId,
      version: row.version,
      displayName: row.displayName,
      bio: row.bio,
      avatarKey: row.avatarKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  async save(profile: Profile): Promise<void> {
    const ex = this.mod.executor
    if (profile.version === 0) {
      try {
        await ex.insert(profiles).values(toRow(profile, 1))
      } catch (err) {
        // Profile vừa được tạo bởi request/handler khác → để client thử lại với dữ liệu mới.
        if (isUniqueViolation(err))
          throw new ConflictError('profile_conflict', 'Profile was just created, retry')
        throw err
      }
    } else {
      const { userId: _id, createdAt: _c, ...changes } = toRow(profile, profile.version + 1)
      const updated = await ex
        .update(profiles)
        .set(changes)
        .where(and(eq(profiles.userId, profile.userId), eq(profiles.version, profile.version)))
        .returning({ userId: profiles.userId })
      if (updated.length === 0) throw new VersionConflictError()
    }
    profile.version += 1
  }

  async createIfAbsent(profile: Profile): Promise<boolean> {
    const inserted = await this.mod.executor
      .insert(profiles)
      .values(toRow(profile, 1))
      .onConflictDoNothing()
      .returning({ userId: profiles.userId })
    return inserted.length > 0
  }
}

function toRow(profile: Profile, version: number) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarKey: profile.avatarKey,
    version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}
