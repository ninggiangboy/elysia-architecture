import { type Database, isPgError } from '@kit/db'
import { sql } from 'drizzle-orm'
import type { Logger } from '#/shared/telemetry'

export interface MaintenanceState {
  active: boolean
  reason: string | null
  since: Date | null
}

const OFF: MaintenanceState = { active: false, reason: null, since: null }

/** undefined_table / invalid_schema_name: the flag has never been written, which means "off". */
const MISSING = ['42P01', '3F000']

/** Raw `execute` rows are not run through the column mappers: a timestamptz arrives as a string. */
type Row = { active: boolean; reason: string | null; since: string | Date | null }

const toState = (row: Row | undefined): MaintenanceState =>
  row
    ? { active: row.active, reason: row.reason, since: row.since ? new Date(row.since) : null }
    : OFF

/**
 * The maintenance flag: one row in `platform.maintenance`, so every instance and process of a deployment sees the same
 * state. The table is not part of a module's migrations on purpose — the flag has to be settable BEFORE the migrations of a
 * deploy run (and while they run), so it creates itself on first write and a missing table reads as "off".
 */
export class MaintenanceStore {
  constructor(private database: Database) {}

  async read(): Promise<MaintenanceState> {
    try {
      const rows = await this.database.db.execute<Row>(
        sql`select active, reason, since from platform.maintenance where id`,
      )
      return toState(rows[0])
    } catch (err) {
      if (isPgError(err, ...MISSING)) return OFF
      throw err
    }
  }

  async write(active: boolean, reason?: string): Promise<MaintenanceState> {
    await this.database.db.execute(sql`create schema if not exists platform`)
    await this.database.db.execute(sql`
      create table if not exists platform.maintenance (
        id boolean primary key default true check (id),
        active boolean not null default false,
        reason text,
        since timestamptz
      )`)
    const rows = await this.database.db.execute<Row>(sql`
      insert into platform.maintenance (id, active, reason, since)
      values (true, ${active}::boolean, ${active ? (reason ?? null) : null}, case when ${active}::boolean then now() end)
      on conflict (id) do update set
        active = excluded.active,
        reason = excluded.reason,
        since = case when excluded.active then coalesce(platform.maintenance.since, now()) end
      returning active, reason, since`)
    return toState(rows[0])
  }
}

type Listener = (active: boolean) => void | Promise<void>

/**
 * This process's view of the flag: a cached value (so the HTTP gate costs nothing per request) refreshed by polling.
 * It changes only on a successful read, so a database blip keeps the last known state instead of opening or closing the gate.
 */
export class MaintenanceMode {
  private state = OFF
  private timer?: ReturnType<typeof setInterval>
  private refreshing = false
  private readonly listeners = new Set<Listener>()

  constructor(
    private store: Pick<MaintenanceStore, 'read'>,
    private logger: Logger,
    private pollIntervalMs: number,
  ) {}

  get active(): boolean {
    return this.state.active
  }

  get current(): MaintenanceState {
    return this.state
  }

  /** Called when the flag flips (not for the first read of a process: that one is applied by whoever awaited `refresh`). */
  onChange(listener: Listener): void {
    this.listeners.add(listener)
  }

  /** Reads the flag now. Throws if the database cannot be read: at boot that is better than guessing. */
  async refresh(): Promise<void> {
    const next = await this.store.read()
    const flipped = next.active !== this.state.active
    this.state = next
    if (!flipped) return
    this.logger.info({ active: next.active, reason: next.reason }, 'maintenance mode changed')
    for (const listener of this.listeners) {
      try {
        await listener(next.active)
      } catch (err) {
        this.logger.error({ err }, 'maintenance listener failed')
      }
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      // A slow read is not overlapped by the next tick.
      if (this.refreshing) return
      this.refreshing = true
      this.refresh()
        .catch((err) => this.logger.warn({ err }, 'reading the maintenance flag failed'))
        .finally(() => {
          this.refreshing = false
        })
    }, this.pollIntervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
