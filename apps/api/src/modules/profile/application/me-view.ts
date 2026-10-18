import type { AccountDto } from '#/modules/identity/contracts'
import type { ObjectStorage } from '#/shared/storage'
import type { Profile } from '../domain/profile'

export interface MeView {
  id: string
  email: string
  /** Language the account is addressed in (mail, notifications); the web app follows it when you sign in. */
  locale: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  coverUrl: string | null
  /** Used for `If-Match` on update. 0 = no profile record yet. */
  version: number
  createdAt: string
}

const IMAGE_URL_TTL_SECONDS = 3600

export function toMeView(account: AccountDto, profile: Profile, storage: ObjectStorage): MeView {
  return {
    id: account.id,
    email: account.email,
    locale: account.locale,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarKey
      ? storage.presignGet(profile.avatarKey, IMAGE_URL_TTL_SECONDS)
      : null,
    coverUrl: profile.coverKey ? storage.presignGet(profile.coverKey, IMAGE_URL_TTL_SECONDS) : null,
    version: profile.version,
    createdAt: account.createdAt,
  }
}
