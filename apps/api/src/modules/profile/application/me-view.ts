import type { AccountDto } from '#/modules/identity/contracts'
import type { ObjectStorage } from '#/shared/application/ports'
import type { Profile } from '../domain/profile'

export interface MeView {
  id: string
  email: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  /** Dùng cho `If-Match` khi cập nhật. 0 = chưa có bản ghi profile. */
  version: number
  createdAt: string
}

const AVATAR_URL_TTL_SECONDS = 3600

export function toMeView(account: AccountDto, profile: Profile, storage: ObjectStorage): MeView {
  return {
    id: account.id,
    email: account.email,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarKey
      ? storage.presignGet(profile.avatarKey, AVATAR_URL_TTL_SECONDS)
      : null,
    version: profile.version,
    createdAt: account.createdAt,
  }
}
