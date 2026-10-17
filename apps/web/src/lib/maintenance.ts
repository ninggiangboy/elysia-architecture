import { useSyncExternalStore } from 'react'
import { apiOrigin } from './config'

/**
 * Why the app is covered by the blocking dialog:
 * - `maintenance`: the API said so (503 `maintenance` — a deploy is running, or `/health/ready` reports it).
 * - `unavailable`: the API cannot be reached (502/503/504 from the proxy in front of it, or no connection) and two probes in a
 *   row confirmed it. During a deploy this is the gap while the app restarts; it turns into `maintenance` once the new
 *   process answers, and is never downgraded back.
 */
type OutageKind = 'maintenance' | 'unavailable'

let kind: OutageKind | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let suspecting = false

const DEFAULT_POLL_MS = 2000
/** Failed probes in a row before an unreachable API counts as an outage: one blip is not one. */
const CONFIRM_PROBES = 2

function set(next: OutageKind | null) {
  if (kind === next) return
  kind = next
  for (const listener of listeners) listener()
}

export const maintenanceStore = {
  get: () => kind,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useMaintenance = () =>
  useSyncExternalStore(maintenanceStore.subscribe, maintenanceStore.get)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `/health/ready` answers 200 even in maintenance mode, so a 200 tells which one it is; anything else is "down". */
async function probe(): Promise<'up' | 'maintenance' | 'down'> {
  try {
    const res = await fetch(`${apiOrigin()}/api/health/ready`, { cache: 'no-store' })
    if (!res.ok) return 'down'
    return ((await res.json()) as { maintenance?: boolean }).maintenance ? 'maintenance' : 'up'
  } catch {
    return 'down'
  }
}

/** Keeps asking until the API is back and out of maintenance, then closes the dialog. */
function watch(pollMs: number) {
  if (timer) return
  const tick = async () => {
    const state = await probe()
    if (state === 'up') {
      timer = undefined
      set(null)
      return
    }
    if (state === 'maintenance') set('maintenance')
    timer = setTimeout(tick, pollMs)
  }
  timer = setTimeout(tick, pollMs)
}

function enterMaintenance(pollMs: number) {
  set('maintenance')
  watch(pollMs)
}

/** Something suggests the API is down: look before showing anything. */
async function suspectOutage(pollMs: number) {
  // The user's own connection is the likely culprit; a dialog about our deploy would be wrong.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (kind || suspecting) return
  suspecting = true
  try {
    for (let i = 0; i < CONFIRM_PROBES; i++) {
      const state = await probe()
      if (state === 'up') return
      if (state === 'maintenance') return enterMaintenance(pollMs)
      if (i < CONFIRM_PROBES - 1) await sleep(pollMs)
    }
    set('unavailable')
    watch(pollMs)
  } finally {
    suspecting = false
  }
}

/**
 * Call with every API response. 503 `maintenance` opens the dialog at once. A 5xx that is not one of the API's own errors
 * (nginx's 502/504 page, the dev proxy's empty 500: something in front of the API talking) only makes us check.
 * Never throws, never consumes the body.
 */
export async function watchResponse(res: Response, pollMs = DEFAULT_POLL_MS): Promise<void> {
  if (res.status < 500) return
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } }
    if (body.error?.code === 'maintenance') return enterMaintenance(pollMs)
    // The API itself answered (e.g. `internal_error`): it is up, this is an ordinary failure.
    if (body.error?.code) return
  } catch {
    // Not JSON: a proxy's error page.
  }
  await suspectOutage(pollMs)
}

/** Call when a request failed before any answer (connection refused, reset, DNS…). Cancelling a request is not a failure. */
export async function watchNetworkFailure(err: unknown, pollMs = DEFAULT_POLL_MS): Promise<void> {
  if (err instanceof DOMException && err.name === 'AbortError') return
  await suspectOutage(pollMs)
}

/** Test seam: back to the initial state. */
export function resetMaintenance(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  suspecting = false
  set(null)
}
