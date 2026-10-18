/**
 * Integration events of the __name__ module. The payload is a public contract: only add fields (backward compatible);
 * breaking changes need a new version (`.v2`) emitted in parallel for a while.
 */
export const __Name__Events = {
  Pinged: '__name__.pinged.v1',
} as const

export interface __Name__PingedPayload {
  userId: string
  pingedAt: string
}
