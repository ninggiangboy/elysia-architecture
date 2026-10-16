import { and, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { MessagePublisher } from '#/shared/application/ports'
import { withAdvisoryXactLock } from '#/shared/infrastructure/db/advisory-lock'
import type { Database } from '#/shared/infrastructure/db/database'
import type { Logger } from '#/shared/infrastructure/logger'
import type { Envelope, MessageHeaders } from '#/shared/messaging/envelope'
import { RetryLaterError } from '#/shared/messaging/errors'
import type { OutboxTable } from './tables'

export interface OutboxSource {
  /** Tên module phát event (ghi vào envelope.source). */
  name: string
  table: OutboxTable
}

export interface OutboxRelayOptions {
  pollIntervalMs: number
  batchSize?: number
  leaseSeconds?: number
  maxAttempts?: number
  retentionDays?: number
  /** Thời gian tối đa một message được hoãn vì RetryLaterError (rate limit) trước khi bị coi là dead. */
  deferBudgetMs?: number
  /** Độ trễ mặc định khi RetryLaterError không kèm retryAfterMs. */
  defaultDeferMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Đọc outbox của từng module và đẩy qua MessagePublisher. An toàn khi chạy nhiều instance:
 * claim bằng `FOR UPDATE SKIP LOCKED` + lease nên mỗi message chỉ do một instance xử lý tại một thời điểm.
 */
export class OutboxRelay {
  private running = false
  private loop?: Promise<void>
  private lastCleanup = 0

  private readonly batchSize: number
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
    this.batchSize = options.batchSize ?? 50
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

  /** Dừng nhận batch mới và đợi batch đang xử lý hoàn tất. */
  async stop(): Promise<void> {
    this.running = false
    await this.loop
  }

  private async run(): Promise<void> {
    while (this.running) {
      let processed = 0
      try {
        for (const source of this.sources) processed += await this.drain(source)
        await this.maybeCleanup()
      } catch (err) {
        this.logger.error({ err }, 'outbox relay tick failed')
      }
      // Còn việc thì chạy tiếp ngay, hết việc mới ngủ.
      if (processed === 0) await sleep(this.options.pollIntervalMs)
    }
  }

  /** Xử lý một batch của một nguồn; trả về số message đã claim. */
  async drain(source: OutboxSource): Promise<number> {
    const { table } = source
    const now = new Date()
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

    for (const row of claimed) {
      const envelope: Envelope = {
        id: row.id,
        type: row.type,
        source: source.name,
        aggregateId: row.aggregateId,
        occurredAt: row.occurredAt.toISOString(),
        payload: row.payload,
        headers: row.headers as MessageHeaders,
      }
      try {
        await this.publisher.publish(envelope)
        await this.database.db
          .update(table)
          .set({ publishedAt: new Date(), lockedUntil: null, lastError: null })
          .where(inArrayId(table, row.id))
      } catch (err) {
        await this.recordFailure(source, row, err)
      }
    }
    return claimed.length
  }

  private async recordFailure(
    source: OutboxSource,
    row: { id: string; attempts: number; occurredAt: Date },
    err: unknown,
  ) {
    const errors = flattenErrors(err)
    // Mọi lỗi đều là "thử lại sau" (vd. bị rate limit) → hoãn đúng thời điểm, không tính số lần thử.
    if (
      errors.length > 0 &&
      errors.every((e): e is RetryLaterError => e instanceof RetryLaterError)
    ) {
      return this.defer(source, row, errors)
    }

    const { table } = source
    const message = err instanceof Error ? err.message : String(err)
    const dead = row.attempts >= this.maxAttempts
    // Backoff mũ: 2s, 4s, 8s … tối đa 5 phút.
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
   * Hoãn message tới thời điểm nhà cung cấp/bộ giới hạn cho phép. `attempts` được hoàn lại (relay đã tăng khi claim)
   * để một đợt rate limit dài không đẩy message vào dead; chặn bởi ngân sách thời gian tính từ lúc event phát sinh.
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
    // Jitter 0–10% để các message bị hoãn cùng lúc không đồng loạt quay lại cùng một khoảnh khắc.
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

  /** Xoá message đã publish quá hạn (payload có thể chứa token dùng một lần). Chỉ một instance chạy. */
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

/** Bus gom lỗi của nhiều handler vào AggregateError. */
function flattenErrors(err: unknown): unknown[] {
  return err instanceof AggregateError ? err.errors.flatMap(flattenErrors) : [err]
}

function inArrayId(table: OutboxTable, id: string) {
  return inArray(table.id, [id])
}
