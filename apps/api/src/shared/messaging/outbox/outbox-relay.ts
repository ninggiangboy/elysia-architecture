import { requestContext } from '@kit/context'
import type { Database } from '@kit/db'
import { withAdvisoryXactLock } from '@kit/db'
import { and, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Logger } from '#/shared/telemetry'
import { contextFromTraceparent, recordSpanError, SpanKind, withSpan } from '#/shared/telemetry'
import type { Envelope, MessageHeaders } from '../envelope'
import { RetryLaterError } from '../errors'
import type { MessagePublisher } from '../ports'
import type { OutboxTable } from './tables'

export interface OutboxSource {
  /** Name of the module emitting the event (written to envelope.source). */
  name: string
  table: OutboxTable
}

export interface OutboxRelayOptions {
  pollIntervalMs: number
  batchSize?: number
  /**
   * How many aggregates are processed at the same time within a batch. Messages of one aggregate always run
   * one after another, in id order. Keep it below the DB pool size: each in-flight message holds a connection.
   */
  concurrency?: number
  leaseSeconds?: number
  maxAttempts?: number
  retentionDays?: number
  /** Maximum time a message may be deferred by RetryLaterError (rate limit) before it is considered dead. */
  deferBudgetMs?: number
  /** Default delay when RetryLaterError carries no retryAfterMs. */
  defaultDeferMs?: number
}

type ClaimedRow = {
  id: string
  type: string
  aggregateId: string
  occurredAt: Date
  payload: Record<string, unknown>
  headers: Record<string, string>
  attempts: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Reads each module's outbox and pushes through the MessagePublisher. Safe to run on multiple instances:
 * claims with `FOR UPDATE SKIP LOCKED` + a lease, so each message is handled by one instance at a time.
 */
export class OutboxRelay {
  private running = false
  private paused = false
  private loop?: Promise<void>
  /** The batch being processed right now, if any. */
  private working?: Promise<number>
  private lastCleanup = 0

  private readonly batchSize: number
  private readonly concurrency: number
  private readonly leaseSeconds: number
  private readonly maxAttempts: number
  private readonly retentionDays: number
  private readonly deferBudgetMs: number
  private readonly defaultDeferMs: number

  constructor(
    private database: Database,
    private sources: OutboxSource[],
    private publisher: MessagePublisher,
    private logger: Logger,
    private options: OutboxRelayOptions,
  ) {
    this.batchSize = options.batchSize ?? 200
    this.concurrency = Math.max(1, options.concurrency ?? 8)
    this.leaseSeconds = options.leaseSeconds ?? 30
    this.maxAttempts = options.maxAttempts ?? 10
    this.retentionDays = options.retentionDays ?? 7
    this.deferBudgetMs = options.deferBudgetMs ?? 24 * 3600_000
    this.defaultDeferMs = options.defaultDeferMs ?? 30_000
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loop = this.run()
  }

  /** Stops taking new batches and waits for the in-flight batch to finish. */
  async stop(): Promise<void> {
    this.running = false
    await this.loop
  }

  /**
   * Stops pulling from the outbox but keeps the loop alive: resolves once the batch in flight has finished, so nothing is
   * cut short. What is not published yet stays in the tables for whoever runs next. Safe to call before `start`.
   */
  async pause(): Promise<void> {
    this.paused = true
    await this.working
  }

  resume(): void {
    this.paused = false
  }

  private async run(): Promise<void> {
    while (this.running) {
      let processed = 0
      if (!this.paused) {
        this.working = this.tick()
        processed = await this.working
        this.working = undefined
      }
      // Keep going immediately while there is work, sleep only when idle (or paused).
      if (processed === 0) await sleep(this.options.pollIntervalMs)
    }
  }

  private async tick(): Promise<number> {
    let processed = 0
    try {
      for (const source of this.sources) {
        if (this.paused) break
        processed += await this.drain(source)
      }
      if (!this.paused) await this.maybeCleanup()
    } catch (err) {
      this.logger.error({ err }, 'outbox relay tick failed')
    }
    return processed
  }

  /** Processes one batch of one source; returns the number of messages claimed. */
  async drain(source: OutboxSource): Promise<number> {
    const { table } = source
    // One clock: due-ness and lease expiry are compared with the database's `now()`, the same clock that sets the lease.
    const now = sql`now()`
    const claimed = await this.database.db
      .update(table)
      .set({
        lockedUntil: sql`now() + make_interval(secs => ${this.leaseSeconds})`,
        attempts: sql`${table.attempts} + 1`,
      })
      .where(
        inArray(
          table.id,
          this.database.db
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                isNull(table.publishedAt),
                isNull(table.deadAt),
                lte(table.nextAttemptAt, now),
                or(isNull(table.lockedUntil), lt(table.lockedUntil, now)),
              ),
            )
            .orderBy(table.id)
            .limit(this.batchSize)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning()

    // Ordering: RETURNING has no defined order and ids are UUIDv7 (time-ordered), so sort by id, then run the
    // messages of one aggregate strictly in sequence while different aggregates proceed in parallel.
    const byAggregate = new Map<string, typeof claimed>()
    for (const row of [...claimed].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const group = byAggregate.get(row.aggregateId) ?? []
      group.push(row)
      byAggregate.set(row.aggregateId, group)
    }
    const queue = [...byAggregate.values()]
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const row of group) await this.process(source, row)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker))
    return claimed.length
  }

  private async process(source: OutboxSource, row: ClaimedRow): Promise<void> {
    const { table } = source
    const envelope: Envelope = {
      id: row.id,
      type: row.type,
      source: source.name,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt.toISOString(),
      payload: row.payload,
      headers: row.headers as MessageHeaders,
    }
    // Handlers run in the context of the request that caused the event: their log lines carry its correlation id, and the
    // events they write in turn keep it (causation = this message).
    const context = {
      requestId: row.id,
      correlationId: row.headers.correlationId ?? row.id,
    }
    // Continues the trace of whatever wrote the event (a request, or a handler that emitted a follow-up event).
    const published = await requestContext.run(context, () =>
      withSpan(
        `outbox.relay ${row.type}`,
        {
          kind: SpanKind.CONSUMER,
          parent: contextFromTraceparent(row.headers.traceparent),
          attributes: {
            'messaging.system': 'outbox',
            'messaging.message.id': row.id,
            'messaging.destination.name': row.type,
            'outbox.source': source.name,
            'outbox.attempt': row.attempts,
            'app.correlation_id': row.headers.correlationId,
          },
        },
        async (span) => {
          try {
            await this.publisher.publish(envelope)
            return true
          } catch (err) {
            // Deferred by a rate limit is the system working as designed; only real failures mark the span.
            if (!isDeferral(err)) recordSpanError(span, err)
            else span.setAttribute('outbox.deferred', true)
            await this.safely(row, () => this.recordFailure(source, row, err))
            return false
          }
        },
      ),
    )
    if (!published) return
    // Published but not yet marked: if marking fails the lease expires and the message is redelivered (at-least-once).
    await this.safely(row, () =>
      this.database.db
        .update(table)
        .set({ publishedAt: new Date(), lockedUntil: null, lastError: null })
        .where(inArrayId(table, row.id)),
    )
  }

  /** One message's bookkeeping failing must not abandon the rest of the batch: its lease will expire and it is retried. */
  private async safely(row: { id: string }, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.logger.error({ err, messageId: row.id }, 'outbox bookkeeping failed, lease will expire')
    }
  }

  private async recordFailure(
    source: OutboxSource,
    row: { id: string; attempts: number; occurredAt: Date },
    err: unknown,
  ) {
    const errors = flattenErrors(err)
    // Every error here means "retry later" (e.g. rate limited) → defer to the right time, without counting an attempt.
    if (
      errors.length > 0 &&
      errors.every((e): e is RetryLaterError => e instanceof RetryLaterError)
    ) {
      return this.defer(source, row, errors)
    }

    const { table } = source
    const message = err instanceof Error ? err.message : String(err)
    const dead = row.attempts >= this.maxAttempts
    // Exponential backoff: 2s, 4s, 8s … up to 5 minutes.
    const delaySeconds = Math.min(2 ** row.attempts, 300)
    this.logger.warn(
      { messageId: row.id, attempts: row.attempts, dead, err: message },
      'outbox publish failed',
    )
    await this.database.db
      .update(table)
      .set({
        lockedUntil: null,
        lastError: message.slice(0, 2000),
        nextAttemptAt: sql`now() + make_interval(secs => ${delaySeconds})`,
        deadAt: dead ? new Date() : null,
      })
      .where(inArrayId(table, row.id))
  }

  /**
   * Defers the message until the provider/limiter allows it. `attempts` is given back (the relay incremented it on claim)
   * so a long rate-limit spell does not push the message to dead; bounded by a time budget counted from when the event occurred.
   */
  private async defer(
    source: OutboxSource,
    row: { id: string; attempts: number; occurredAt: Date },
    errors: RetryLaterError[],
  ) {
    const { table } = source
    const message = errors.map((e) => e.message).join('; ')
    const ageMs = Date.now() - row.occurredAt.getTime()
    const exhausted = ageMs > this.deferBudgetMs
    const hinted = Math.max(0, ...errors.map((e) => e.retryAfterMs ?? 0))
    // 0–10% jitter so messages deferred together do not all return at the same instant.
    const baseMs = hinted > 0 ? hinted : this.defaultDeferMs
    const delayMs = Math.ceil(baseMs * (1 + Math.random() * 0.1))
    this.logger.info(
      { messageId: row.id, delayMs, ageMs, exhausted, reason: message },
      exhausted ? 'outbox message exhausted its deferral budget' : 'outbox message deferred',
    )
    await this.database.db
      .update(table)
      .set({
        lockedUntil: null,
        attempts: sql`greatest(${table.attempts} - 1, 0)`,
        lastError: `deferred: ${message}`.slice(0, 2000),
        nextAttemptAt: sql`now() + make_interval(secs => ${delayMs / 1000})`,
        deadAt: exhausted ? new Date() : null,
      })
      .where(inArrayId(table, row.id))
  }

  /** Deletes published messages past retention (the payload may contain one-time tokens). Runs on one instance only. */
  private async maybeCleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < 10 * 60_000) return
    this.lastCleanup = Date.now()
    for (const { name, table } of this.sources) {
      await withAdvisoryXactLock(this.database, `outbox-cleanup:${name}`, async () => {
        await this.database.executor
          .delete(table)
          .where(
            and(
              isNotNull(table.publishedAt),
              lt(table.publishedAt, sql`now() - make_interval(days => ${this.retentionDays})`),
            ),
          )
      })
    }
  }
}

function isDeferral(err: unknown): boolean {
  const errors = flattenErrors(err)
  return errors.length > 0 && errors.every((e) => e instanceof RetryLaterError)
}

/** Bus that collects errors from several handlers into an AggregateError. */
function flattenErrors(err: unknown): unknown[] {
  return err instanceof AggregateError ? err.errors.flatMap(flattenErrors) : [err]
}

function inArrayId(table: OutboxTable, id: string) {
  return inArray(table.id, [id])
}
