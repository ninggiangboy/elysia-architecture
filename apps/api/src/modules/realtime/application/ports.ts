/** What a client receives — the JSON in each SSE `data:` line. */
export interface RealtimeMessage {
  id: string
  type: string
  data: Record<string, unknown>
  at: string
}

export interface RealtimeEvent {
  type: string
  data: Record<string, unknown>
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
   * `true` when the client's `Last-Event-ID` was still in the replay buffer, so `start()` sends every event it missed
   * and it need not refetch its state. `false` (no id, unknown id, too old, or too many missed): refetch.
   */
  readonly resumed: boolean
  /** Sends the replayed events, then switches to live delivery with no gap and no duplicate. */
  start(): void
  unregister(): void
}

export interface RealtimeGateway {
  /**
   * Stores the event briefly (for replay) and delivers it to every open connection of the user — on whichever API
   * instance holds it. Offline users get it from the replay buffer if they reconnect in time.
   * `closeSessionId`: after delivery, connections opened by that session are closed by the server.
   */
  publish(target: { userId: string; closeSessionId?: string }, event: RealtimeEvent): Promise<void>
  /**
   * Starts collecting the user's messages for `connection`; resolves once none can be missed.
   * `lastEventId`: the last `id` the client saw (`Last-Event-ID` header) — untrusted input.
   */
  register(connection: RealtimeConnection, lastEventId?: string): Promise<RealtimeRegistration>
}
