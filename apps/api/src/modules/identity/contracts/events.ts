/**
 * Integration event do identity phát ra. Payload là hợp đồng công khai: chỉ thêm field (backward compatible);
 * thay đổi phá vỡ phải ra version mới (`.v2`) và phát song song một thời gian.
 */
export const IdentityEvents = {
  MagicLinkRequested: 'identity.magic_link_requested.v1',
  UserRegistered: 'identity.user_registered.v1',
  EmailChangeRequested: 'identity.email_change_requested.v1',
  EmailChanged: 'identity.email_changed.v1',
} as const

export interface MagicLinkRequestedPayload {
  email: string
  /** Token thô — chỉ nằm trong outbox cho tới khi bị dọn. */
  token: string
  expiresAt: string
}

export interface UserRegisteredPayload {
  userId: string
  email: string
  registeredAt: string
}

export interface EmailChangeRequestedPayload {
  userId: string
  newEmail: string
  token: string
  expiresAt: string
}

export interface EmailChangedPayload {
  userId: string
  oldEmail: string
  newEmail: string
  changedAt: string
}
