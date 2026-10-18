/**
 * What a module hands to realtime so its events reach the user's open tabs. Realtime knows no producer: each producer
 * ships a `RealtimeIntegration` (in its `integrations/realtime.ts`) and the composition root installs the ones it wants.
 */
export interface RealtimeEvent {
  type: string
  data: Record<string, unknown>
  /**
   * Opt in to replay, default `false`. Set it only for an event whose loss the client cannot repair by refetching its state
   * (a chat message, a step of a long job…): it is then stored briefly and re-sent to a client that reconnects with `Last-Event-ID`.
   * "Something changed, refetch" events should leave it off — they cost no storage.
   */
  replay?: boolean
}

export interface RealtimePush {
  userId: string
  event: RealtimeEvent
  /** After delivery, the connections opened by this login session are closed by the server. */
  closeSessionId?: string
}

/** Integration event → push. */
export interface RealtimeRoute<TPayload = unknown> {
  /** Handler name = consumer group = inbox key once something depends on it: keep it stable. */
  name: string
  eventType: string
  /** `null` = nothing to tell the user for this event. */
  map(payload: TPayload): RealtimePush | null
}

/** Integration event → forget what was stored for the user (the replay buffer holds notification text). */
export interface RealtimePurgeRule<TPayload = unknown> {
  name: string
  eventType: string
  userId(payload: TPayload): string
}

export interface RealtimeIntegration {
  routes?: readonly RealtimeRoute[]
  purgeOn?: readonly RealtimePurgeRule[]
}

/** Keeps the payload type of a route inferred from `map` while the array of routes stays heterogeneous. */
export const realtimeRoute = <TPayload>(route: RealtimeRoute<TPayload>) => route
export const realtimePurgeRule = <TPayload>(rule: RealtimePurgeRule<TPayload>) => rule
