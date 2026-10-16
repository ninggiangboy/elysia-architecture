export const ProfileEvents = {
  AvatarChanged: 'profile.avatar_changed.v1',
  CoverChanged: 'profile.cover_changed.v1',
  /** Answers to the privacy module's requests (see `privacy/contracts`). */
  DataExported: 'profile.data_exported.v1',
  UserDataErased: 'profile.user_data_erased.v1',
} as const

export interface AvatarChangedPayload {
  userId: string
  oldKey: string | null
  newKey: string
  changedAt: string
}

export interface CoverChangedPayload {
  userId: string
  oldKey: string | null
  newKey: string
  changedAt: string
}
