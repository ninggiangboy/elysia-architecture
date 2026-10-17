import { useSyncExternalStore } from 'react'
import { apiOrigin } from './config'

/**
 * Maintenance mode as the web app sees it: the API answers 503 `maintenance` while a deploy runs. The first such answer
 * turns `active` on (a blocking dialog covers the app) and starts asking `/health/ready`, which stays up during maintenance,
 * until the server says it is over.
 */
let active = false
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function set(next: boolean) {
  if (active === next) return
  active = next
  for (const listener of listeners) listener()
}

export const maintenanceStore = {
  get: () => active,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useMaintenance = () =>
  useSyncExternalStore(maintenanceStore.subscribe, maintenanceStore.get)

/** True once the server reports that maintenance mode is off. While it restarts, the probe fails: keep waiting. */
async function maintenanceOver(): Promise<boolean> {
  try {
    const res = await fetch(`${apiOrigin()}/api/health/ready`, { cache: 'no-store' })
    return res.ok && ((await res.json()) as { maintenance?: boolean }).maintenance === false
  } catch {
    return false
  }
}

function enterMaintenance(pollMs = 2000): void {
  set(true)
  if (timer) return
  const tick = async () => {
    if (await maintenanceOver()) {
      timer = undefined
      set(false)
    } else timer = setTimeout(tick, pollMs)
  }
  timer = setTimeout(tick, pollMs)
}

/** Call with any API response: a 503 `maintenance` brings up the dialog. Never throws, never consumes the body. */
export async function reportIfMaintenance(res: Response, pollMs?: number): Promise<void> {
  if (res.status !== 503) return
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } }
    if (body.error?.code === 'maintenance') enterMaintenance(pollMs)
  } catch {
    // Not our JSON (a proxy's 503): not a maintenance announcement.
  }
}

/** Test seam: back to the initial state. */
export function resetMaintenance(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  set(false)
}
