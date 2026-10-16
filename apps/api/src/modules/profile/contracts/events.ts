export const ProfileEvents = {
  AvatarChanged: 'profile.avatar_changed.v1',
  CoverChanged: 'profile.cover_changed.v1',
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
