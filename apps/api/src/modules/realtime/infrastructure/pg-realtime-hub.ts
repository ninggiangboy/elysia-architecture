import { and, asc, eq, lt, sql } from 'drizzle-orm'
import type { Clock, Log } from '#/shared/application/ports'
import type { Database } from '#/shared/infrastructure/db/database'
import type {
  RealtimeConnection,
  RealtimeEvent,
  RealtimeGateway,
  RealtimeMessage,
  RealtimeRegistration,
} from '../application/ports'
import { events } from './persistence/schema'

const CHANNEL = 'realtime'
/** Postgres rejects NOTIFY payloads of 8000 bytes or more. */
const MAX_PAYLOAD_BYTES = 7500
/** A client that missed more than this is told to refetch instead of being flooded. */
export const MAX_REPLAY = 200

interface Wire {
  userId: string
  closeSessionId?: string
  message: RealtimeMessage
}

/** One registered connection: it queues live messages until `start()` has replayed what the client missed. */
interface Subscriber {
  connection: RealtimeConnection
  live: boolean
  queue: RealtimeMessage[]
  /** Set when the server must hang up but the client has not been sent its queue yet: closed right after `start()`. */
  closeReason?: string
}

/** `Last-Event-ID` is client input: accept only a plain non-negative integer. */
export function parseEventId(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{1,15}$/.test(raw)) return undefined
  return Number(raw)
}

/**
 * Fan-out across API instances without Redis: `publish` = insert into `realtime.events` + `NOTIFY realtime` in one
 * transaction, every instance that has at least one connection holds a dedicated `LISTEN realtime` connection and hands
 * the message to its local sockets.
 *
 * Replay: the insert gives each message a per-user increasing `seq` (the SSE `id`). A client that reconnects sends it
 * back as `Last-Event-ID` and `register` replays what it missed from the buffer, which `prune` keeps short.
 *
 * Limits (by design): a notification sent while an instance is (re)connecting its LISTEN is not pushed live, but a
 * client that reconnects in time still replays it. Past the replay window (or `MAX_REPLAY` events) clients refetch state.
 * LISTEN needs a direct Postgres connection (not PgBouncer in transaction mode).
 */
export class PgRealtimeHub implements RealtimeGateway {
  private byUser = new Map<string, Set<Subscriber>>()
  private listening?: Promise<{ unlisten(): Promise<void> }>
  private stopped = false

  constructor(
    private database: Database,
    private clock: Clock,
    private log: Log,
  ) {}

  async publish(
    target: { userId: string; closeSessionId?: string },
    event: RealtimeEvent,
  ): Promise<void> {
    const at = this.clock.now()
    await this.database.db.transaction(async (tx) => {
      // Per-user lock: seq order = commit order for one user, so a reconnecting client never skips an event.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${target.userId}, 0))`)
      const [row] = await tx
        .insert(events)
        .values({ userId: target.userId, type: event.type, data: event.data, createdAt: at })
        .returning({ seq: events.seq })
      const wire: Wire = {
        userId: target.userId,
        closeSessionId: target.closeSessionId,
        message: { id: String(row?.seq), type: event.type, data: event.data, at: at.toISOString() },
      }
      const payload = JSON.stringify(wire)
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
        throw new Error(`realtime payload too large for ${event.type}`)
      }
      // Delivered when the transaction commits, i.e. after the row is visible to replays.
      await tx.execute(sql`select pg_notify(${CHANNEL}, ${payload})`)
    })
  }

  async register(
    connection: RealtimeConnection,
    lastEventId?: string,
  ): Promise<RealtimeRegistration> {
    if (this.stopped) {
      connection.close('server_shutdown')
      return { resumed: false, start() {}, unregister() {} }
    }
    // Lazy: processes that never serve a connection (e.g. a relay-only replica) never open a LISTEN connection.
    this.listening ??= this.database.client
      .listen(CHANNEL, (raw) => this.dispatch(raw))
      .catch((err) => {
        this.listening = undefined
        throw err
      })
    await this.listening

    // Subscribe BEFORE reading the buffer: an event committed in between is both queued and replayed, and de-duplicated in start().
    const subscriber: Subscriber = { connection, live: false, queue: [] }
    const set = this.byUser.get(connection.userId) ?? new Set<Subscriber>()
    set.add(subscriber)
    this.byUser.set(connection.userId, set)
    const unregister = () => {
      const current = this.byUser.get(connection.userId)
      current?.delete(subscriber)
      if (current?.size === 0) this.byUser.delete(connection.userId)
    }

    let replay: { messages: RealtimeMessage[]; after: number } | undefined
    try {
      replay = await this.replayAfter(connection.userId, parseEventId(lastEventId))
    } catch (err) {
      // The buffer is an optimisation: without it the client simply refetches.
      this.log.warn({ err, connectionId: connection.id }, 'realtime replay failed')
    }

    return {
      resumed: replay !== undefined,
      unregister,
      start: () => {
        let sent = replay?.after ?? 0
        for (const message of replay?.messages ?? []) {
          this.deliver(subscriber, message)
          sent = Number(message.id)
        }
        subscriber.live = true
        for (const message of subscriber.queue.splice(0)) {
          if (Number(message.id) > sent) this.deliver(subscriber, message)
        }
        if (subscriber.closeReason) this.close(subscriber, subscriber.closeReason)
      },
    }
  }

  /** Events the user missed after `afterSeq`, or `undefined` when the buffer cannot vouch for a gap-free replay. */
  private async replayAfter(userId: string, afterSeq: number | undefined) {
    if (afterSeq === undefined) return undefined
    // The anchor must still exist: if it was pruned, the events right after it may have been too.
    const [anchor] = await this.database.db
      .select({ seq: events.seq })
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.seq, afterSeq)))
      .limit(1)
    if (!anchor) return undefined
    const rows = await this.database.db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), sql`${events.seq} > ${afterSeq}`))
      .orderBy(asc(events.seq))
      .limit(MAX_REPLAY + 1)
    if (rows.length > MAX_REPLAY) return undefined
    return {
      after: afterSeq,
      messages: rows.map(
        (r): RealtimeMessage => ({
          id: String(r.seq),
          type: r.type,
          data: r.data,
          at: r.createdAt.toISOString(),
        }),
      ),
    }
  }

  /** Deletes events older than `olderThan`. Returns how many were removed. */
  async prune(olderThan: Date): Promise<number> {
    const rows = await this.database.db
      .delete(events)
      .where(lt(events.createdAt, olderThan))
      .returning({ seq: events.seq })
    return rows.length
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
      for (const subscriber of [...set]) subscriber.connection.close('server_shutdown')
    }
    this.byUser.clear()
    const listening = this.listening
    this.listening = undefined
    await (await listening?.catch(() => undefined))?.unlisten()
  }

  private deliver(subscriber: Subscriber, message: RealtimeMessage): void {
    try {
      subscriber.connection.send(message)
    } catch (err) {
      this.log.warn({ err, connectionId: subscriber.connection.id }, 'realtime delivery failed')
    }
  }

  private dispatch(raw: string): void {
    let wire: Wire
    try {
      wire = JSON.parse(raw) as Wire
    } catch {
      this.log.warn({ raw: raw.slice(0, 200) }, 'ignoring malformed realtime notification')
      return
    }
    const subscribers = this.byUser.get(wire.userId)
    if (!subscribers) return
    for (const subscriber of [...subscribers]) {
      if (subscriber.live) this.deliver(subscriber, wire.message)
      else subscriber.queue.push(wire.message)
      if (wire.closeSessionId && subscriber.connection.sessionId === wire.closeSessionId) {
        if (subscriber.live) this.close(subscriber, 'session_revoked')
        else subscriber.closeReason = 'session_revoked'
      }
    }
  }

  private close(subscriber: Subscriber, reason: string): void {
    try {
      subscriber.connection.close(reason)
    } catch (err) {
      this.log.warn({ err, connectionId: subscriber.connection.id }, 'realtime close failed')
    }
  }
}
