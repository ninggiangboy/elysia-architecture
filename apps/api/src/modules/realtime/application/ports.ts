/** What a client receives — the JSON in each SSE `data:` line. */
export interface RealtimeMessage {
  /** Only on `replay` events (it is the SSE `id:` and what `Last-Event-ID` points to). */
  id?: string
  type: string
  data: Record<string, unknown>
  at: string
}

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

/** One open SSE stream. */
export interface RealtimeConnection {
  readonly id: string
  readonly userId: string
  /** Login session the connection was opened with (`sid` of its access token). */
  readonly sessionId: string
  send(message: RealtimeMessage): void
  close(reason: string): void
}

/** A registered connection. Nothing is sent to it until `start()`, so the caller can write its own opening frame first. */
export interface RealtimeRegistration {
  /**
   * `true` when the client's `Last-Event-ID` was still in the replay buffer, so `start()` sends every `replay` event it
   * missed. `false` (no id, unknown id, too old, or too many missed): some may be lost, so resync those from the API.
   * Events without `replay` are never part of this; clients always refetch the state they cover when a stream opens.
   */
  readonly resumed: boolean
  /** Position in the replay buffer the stream starts from; the client keeps it (updated by each event `id`) as its next `Last-Event-ID`. */
  readonly cursor: string
  /** Sends the replayed events, then switches to live delivery with no gap and no duplicate. */
  start(): void
  unregister(): void
}

export interface RealtimeGateway {
  /**
   * Delivers the event to every open connection of the user — on whichever API instance holds it. Offline users miss it,
   * unless `event.replay` stored it briefly for replay.
   * `closeSessionId`: after delivery, connections opened by that session are closed by the server.
   */
  publish(target: { userId: string; closeSessionId?: string }, event: RealtimeEvent): Promise<void>
  /**
   * Starts collecting the user's messages for `connection`; resolves once none can be missed.
   * `lastEventId`: the last `id` the client saw (`Last-Event-ID` header) — untrusted input.
   */
  register(connection: RealtimeConnection, lastEventId?: string): Promise<RealtimeRegistration>
}

/** The replay buffer, seen from the one place that must empty it for a user: account erasure. */
export interface ReplayBuffer {
  /** Deletes every stored event of the user; returns how many. */
  purgeUser(userId: string): Promise<number>
}
