import { createStore } from './store'

/**
 * Why the app is covered by the blocking dialog:
 * - `maintenance`: the API said so (503 `maintenance` — a deploy is running, or the health endpoint reports it).
 * - `unavailable`: the API cannot be reached (502/503/504 from the proxy in front of it, or no connection) and two probes in a
 *   row confirmed it. During a deploy this is the gap while the app restarts; it turns into `maintenance` once the new
 *   process answers, and is never downgraded back.
 */
export type OutageKind = 'maintenance' | 'unavailable'

export interface OutageOptions {
  /** The readiness endpoint: answers 200 `{ maintenance: boolean }` when the API is up (also while in maintenance). */
  healthUrl: () => string
  pollMs?: number
  /** Failed probes in a row before an unreachable API counts as an outage: one blip is not one. */
  confirmProbes?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class OutageDetector {
  readonly store = createStore<OutageKind | null>(null)
  private timer: ReturnType<typeof setTimeout> | undefined
  private suspecting = false
  private readonly pollMs: number
  private readonly confirmProbes: number

  constructor(private options: OutageOptions) {
    this.pollMs = options.pollMs ?? 2000
    this.confirmProbes = options.confirmProbes ?? 2
  }

  /** The health endpoint answers 200 even in maintenance mode, so a 200 tells which one it is; anything else is "down". */
  private async probe(): Promise<'up' | 'maintenance' | 'down'> {
    try {
      const res = await fetch(this.options.healthUrl(), { cache: 'no-store' })
      if (!res.ok) return 'down'
      return ((await res.json()) as { maintenance?: boolean }).maintenance ? 'maintenance' : 'up'
    } catch {
      return 'down'
    }
  }

  /** Keeps asking until the API is back and out of maintenance, then closes the dialog. */
  private watch(every: number) {
    if (this.timer) return
    const tick = async () => {
      const state = await this.probe()
      if (state === 'up') {
        this.timer = undefined
        this.store.set(null)
        return
      }
      if (state === 'maintenance') this.store.set('maintenance')
      this.timer = setTimeout(tick, every)
    }
    this.timer = setTimeout(tick, every)
  }

  private enterMaintenance(every: number) {
    this.store.set('maintenance')
    this.watch(every)
  }

  /** Something suggests the API is down: look before showing anything. */
  private async suspectOutage(every: number) {
    // The user's own connection is the likely culprit; a dialog about our deploy would be wrong.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (this.store.get() || this.suspecting) return
    this.suspecting = true
    try {
      for (let i = 0; i < this.confirmProbes; i++) {
        const state = await this.probe()
        if (state === 'up') return
        if (state === 'maintenance') return this.enterMaintenance(every)
        if (i < this.confirmProbes - 1) await sleep(every)
      }
      this.store.set('unavailable')
      this.watch(every)
    } finally {
      this.suspecting = false
    }
  }

  /**
   * Call with every API response. 503 `maintenance` opens the dialog at once. A 5xx that is not one of the API's own errors
   * (nginx's 502/504 page, the dev proxy's empty 500: something in front of the API talking) only makes us check.
   * Never throws, never consumes the body.
   */
  readonly watchResponse = async (res: Response, every = this.pollMs): Promise<void> => {
    if (res.status < 500) return
    try {
      const body = (await res.clone().json()) as { error?: { code?: string } }
      if (body.error?.code === 'maintenance') return this.enterMaintenance(every)
      // The API itself answered (e.g. `internal_error`): it is up, this is an ordinary failure.
      if (body.error?.code) return
    } catch {
      // Not JSON: a proxy's error page.
    }
    await this.suspectOutage(every)
  }

  /** Call when a request failed before any answer (connection refused, reset, DNS…). Cancelling a request is not a failure. */
  readonly watchNetworkFailure = async (err: unknown, every = this.pollMs): Promise<void> => {
    if (err instanceof DOMException && err.name === 'AbortError') return
    await this.suspectOutage(every)
  }

  /** Test seam: back to the initial state. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.suspecting = false
    this.store.set(null)
  }
}

export const createOutageDetector = (options: OutageOptions) => new OutageDetector(options)
