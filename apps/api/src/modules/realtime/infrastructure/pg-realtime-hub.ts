import type postgres from 'postgres'
import type { Clock, IdGenerator, Log } from '#/shared/application/ports'
import type {
  RealtimeConnection,
  RealtimeEvent,
  RealtimeGateway,
  RealtimeMessage,
} from '../application/ports'

const CHANNEL = 'realtime'
/** Postgres rejects NOTIFY payloads of 8000 bytes or more. */
const MAX_PAYLOAD_BYTES = 7500

interface Wire {
  userId: string
  closeSessionId?: string
  message: RealtimeMessage
}

/**
 * Fan-out across API instances without Redis: `publish` = `NOTIFY realtime`, every instance that has at least
 * one connection holds a dedicated `LISTEN realtime` connection and hands the message to its local sockets.
 *
 * Limits (by design): delivery is best-effort — a notification sent while an instance is (re)connecting its LISTEN
 * is lost, so clients must refetch state when they (re)connect. LISTEN needs a direct Postgres connection
 * (not PgBouncer in transaction mode).
 */
export class PgRealtimeHub implements RealtimeGateway {
  private byUser = new Map<string, Set<RealtimeConnection>>()
  private listening?: Promise<{ unlisten(): Promise<void> }>
  private stopped = false

  constructor(
    private client: postgres.Sql,
    private ids: IdGenerator,
    private clock: Clock,
    private log: Log,
  ) {}

  async publish(
    target: { userId: string; closeSessionId?: string },
    event: RealtimeEvent,
  ): Promise<void> {
    const wire: Wire = {
      userId: target.userId,
      closeSessionId: target.closeSessionId,
      message: {
        id: this.ids.next(),
        type: event.type,
        data: event.data,
        at: this.clock.now().toISOString(),
      },
    }
    const payload = JSON.stringify(wire)
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
      throw new Error(`realtime payload too large for ${event.type}`)
    }
    await this.client.notify(CHANNEL, payload)
  }

  async register(connection: RealtimeConnection): Promise<() => void> {
    if (this.stopped) {
      connection.close('server_shutdown')
      return () => {}
    }
    // Lazy: processes that never serve a connection (e.g. a relay-only replica) never open a LISTEN connection.
    this.listening ??= this.client
      .listen(CHANNEL, (raw) => this.dispatch(raw))
      .catch((err) => {
        this.listening = undefined
        throw err
      })
    await this.listening

    const set = this.byUser.get(connection.userId) ?? new Set<RealtimeConnection>()
    set.add(connection)
    this.byUser.set(connection.userId, set)
    return () => {
      const current = this.byUser.get(connection.userId)
      current?.delete(connection)
      if (current?.size === 0) this.byUser.delete(connection.userId)
    }
  }

  connectionCount(): number {
    let n = 0
    for (const set of this.byUser.values()) n += set.size
    return n
  }

  /** Closes every local connection (so `Bun.serve().stop()` does not wait on them) and stops listening. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const set of [...this.byUser.values()]) {
      for (const connection of [...set]) connection.close('server_shutdown')
    }
    this.byUser.clear()
    const listening = this.listening
    this.listening = undefined
    await (await listening?.catch(() => undefined))?.unlisten()
  }

  private dispatch(raw: string): void {
    let wire: Wire
    try {
      wire = JSON.parse(raw) as Wire
    } catch {
      this.log.warn({ raw: raw.slice(0, 200) }, 'ignoring malformed realtime notification')
      return
    }
    const connections = this.byUser.get(wire.userId)
    if (!connections) return
    for (const connection of [...connections]) {
      try {
        connection.send(wire.message)
        if (wire.closeSessionId && connection.sessionId === wire.closeSessionId) {
          connection.close('session_revoked')
        }
      } catch (err) {
        this.log.warn({ err, connectionId: connection.id }, 'realtime delivery failed')
      }
    }
  }
}
