import type { Clock, Log } from '@kit/core'
import type { Database } from '@kit/db'
import { and, asc, eq, gt, lt, min, sql } from 'drizzle-orm'
import type {
  RealtimeConnection,
  RealtimeEvent,
  RealtimeGateway,
  RealtimeMessage,
  RealtimeRegistration,
  ReplayBuffer,
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

/** What a reconnecting client missed, and the login sessions whose connections that hangs up. */
interface Replay {
  messages: RealtimeMessage[]
  closesSession: Set<string>
}

/** `Last-Event-ID` is client input: accept only a plain non-negative integer. */
export function parseEventId(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{1,15}$/.test(raw)) return undefined
  return Number(raw)
}

/**
 * Fan-out across API instances without Redis: `publish` = `NOTIFY realtime` (for `replay` events: plus an insert into
 * `realtime.events` in the same transaction), every instance that has at least one connection holds a dedicated `LISTEN realtime` connection
 * and hands the message to its local sockets.
 *
 * Replay: the insert gives each message a per-user increasing `seq` (the SSE `id`). A client that reconnects sends it
 * back as `Last-Event-ID` and `register` replays what it missed from the buffer, which `prune` keeps short.
 *
 * Limits (by design): a notification sent while an instance is (re)connecting its LISTEN is not pushed live, but a
 * client that reconnects in time still replays it. Past the replay window (or `MAX_REPLAY` events) clients refetch state.
 * LISTEN needs a direct Postgres connection (not PgBouncer in transaction mode).
 */
export class PgRealtimeHub implements RealtimeGateway, ReplayBuffer {
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
    if (!event.replay) {
      const message: RealtimeMessage = { type: event.type, data: event.data, at: at.toISOString() }
      await this.database.client.notify(CHANNEL, this.encode(target, message, event.type))
      return
    }
    await this.database.db.transaction(async (tx) => {
      // Per-user lock: seq order = commit order for one user, so a reconnecting client never skips an event.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${target.userId}, 0))`)
      const [row] = await tx
        .insert(events)
        .values({
          userId: target.userId,
          type: event.type,
          data: event.data,
          closeSessionId: target.closeSessionId,
          createdAt: at,
        })
        .returning({ seq: events.seq })
      const message: RealtimeMessage = {
        id: String(row?.seq),
        type: event.type,
        data: event.data,
        at: at.toISOString(),
      }
      const payload = this.encode(target, message, event.type)
      // Delivered when the transaction commits, i.e. after the row is visible to replays.
      await tx.execute(sql`select pg_notify(${CHANNEL}, ${payload})`)
    })
  }

  private encode(
    target: { userId: string; closeSessionId?: string },
    message: RealtimeMessage,
    type: string,
  ): string {
    const wire: Wire = { userId: target.userId, closeSessionId: target.closeSessionId, message }
    const payload = JSON.stringify(wire)
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
      throw new Error(`realtime payload too large for ${type}`)
    }
    return payload
  }

  async register(
    connection: RealtimeConnection,
    lastEventId?: string,
  ): Promise<RealtimeRegistration> {
    if (this.stopped) {
      connection.close('server_shutdown')
      return { resumed: false, cursor: '0', start() {}, unregister() {} }
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

    // `cursor` is where this stream starts in the buffer: the client sends it back as Last-Event-ID, even if it never sees a replay event.
    let cursor = 0
    let replay: Replay | undefined
    try {
      const head = await this.readHead()
      cursor = head.head
      replay = await this.replayAfter(connection.userId, parseEventId(lastEventId), head)
    } catch (err) {
      // The buffer is an optimisation: without it the client simply resyncs.
      this.log.warn({ err, connectionId: connection.id }, 'realtime replay failed')
    }

    return {
      resumed: replay !== undefined,
      cursor: String(cursor),
      unregister,
      start: () => {
        const replayed = new Set<string | undefined>()
        for (const message of replay?.messages ?? []) {
          this.deliver(subscriber, message)
          replayed.add(message.id)
        }
        if (replay?.closesSession.has(connection.sessionId))
          subscriber.closeReason = 'session_revoked'
        subscriber.live = true
        // An event committed while the buffer was being read is both replayed and queued: send it once.
        for (const message of subscriber.queue.splice(0)) {
          if (!message.id || !replayed.has(message.id)) this.deliver(subscriber, message)
        }
        if (subscriber.closeReason) this.close(subscriber, subscriber.closeReason)
      },
    }
  }

  /** Newest allocated `seq` (0 if none yet) and the oldest one still stored. */
  private async readHead(): Promise<{ head: number; oldest: number }> {
    const [seq] = await this.database.db.execute<{ last_value: string; is_called: boolean }>(
      sql`select last_value, is_called from realtime.events_seq_seq`,
    )
    const head = seq?.is_called ? Number(seq.last_value) : 0
    const [row] = await this.database.db.select({ oldest: min(events.seq) }).from(events)
    return { head, oldest: row?.oldest == null ? head + 1 : Number(row.oldest) }
  }

  /**
   * The user's events after `cursor`, or `undefined` when the buffer cannot vouch for a gap-free replay: no cursor,
   * one from the future, or one older than the oldest stored event (what came right after it may have been pruned).
   */
  private async replayAfter(
    userId: string,
    cursor: number | undefined,
    { head, oldest }: { head: number; oldest: number },
  ): Promise<Replay | undefined> {
    if (cursor === undefined || cursor > head || cursor < oldest - 1) return undefined
    const rows = await this.database.db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), gt(events.seq, cursor)))
      .orderBy(asc(events.seq))
      .limit(MAX_REPLAY + 1)
    if (rows.length > MAX_REPLAY) return undefined
    return {
      messages: rows.map(
        (r): RealtimeMessage => ({
          id: String(r.seq),
          type: r.type,
          data: r.data,
          at: r.createdAt.toISOString(),
        }),
      ),
      closesSession: new Set(rows.flatMap((r) => (r.closeSessionId ? [r.closeSessionId] : []))),
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

  async purgeUser(userId: string): Promise<number> {
    const rows = await this.database.db
      .delete(events)
      .where(eq(events.userId, userId))
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
