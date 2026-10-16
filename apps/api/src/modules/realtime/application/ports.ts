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

export interface RealtimeGateway {
  /**
   * Delivers the event to every open connection of the user — on whichever API instance holds it.
   * Fire-and-forget: offline users miss it (clients refetch state when they reconnect).
   * `closeSessionId`: after delivery, connections opened by that session are closed by the server.
   */
  publish(target: { userId: string; closeSessionId?: string }, event: RealtimeEvent): Promise<void>
  /** Starts delivering the user's messages to `connection`; resolves once none can be missed. Returns the unregister function. */
  register(connection: RealtimeConnection): Promise<() => void>
}
