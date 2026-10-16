export const ProfileEvents = {
  AvatarChanged: 'profile.avatar_changed.v1',
} as const

export interface AvatarChangedPayload {
  userId: string
  oldKey: string | null
  newKey: string
  changedAt: string
}
