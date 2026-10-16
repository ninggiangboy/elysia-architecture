import type { DataExporter, ExportedFile, ExportedPart } from '#/shared/application/privacy'
import type { ProfileRepository } from '../domain/profile-repository'

const extensionOf = (key: string) => {
  const dot = key.lastIndexOf('.')
  return dot > key.lastIndexOf('/') ? key.slice(dot) : ''
}

/** What profile holds about a user, for a data export: the profile itself and the two images they uploaded. */
export class ProfileDataExporter implements DataExporter {
  constructor(private profiles: ProfileRepository) {}

  async collect(userId: string): Promise<ExportedPart> {
    const profile = await this.profiles.findByUserId(userId)
    if (!profile) return { data: { profile: null } }

    const files: ExportedFile[] = []
    // Originals only: the thumbnails are derived and can be made again.
    if (profile.avatarKey)
      files.push({
        path: `profile/avatar${extensionOf(profile.avatarKey)}`,
        key: profile.avatarKey,
      })
    if (profile.coverKey)
      files.push({ path: `profile/cover${extensionOf(profile.coverKey)}`, key: profile.coverKey })
    return {
      data: {
        profile: {
          displayName: profile.displayName,
          bio: profile.bio,
          avatar: files.find((f) => f.key === profile.avatarKey)?.path ?? null,
          cover: files.find((f) => f.key === profile.coverKey)?.path ?? null,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        },
      },
      files,
    }
  }
}
