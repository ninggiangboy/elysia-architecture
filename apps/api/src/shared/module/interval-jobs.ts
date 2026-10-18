import type { ModuleJobs } from './app-module'

/**
 * Runs `run` every `intervalMs`. A slow pass is not overlapped by the next tick; two processes may still tick together,
 * so `run` must claim its work with row locks (SKIP LOCKED / conditional updates). `stop` waits for the pass in flight.
 */
export function intervalJobs(options: {
  intervalMs: number
  run: () => Promise<unknown>
  onError: (err: unknown) => void
}): ModuleJobs {
  let timer: ReturnType<typeof setInterval> | undefined
  let running: Promise<unknown> | undefined
  const tick = () => {
    running ??= options
      .run()
      .catch(options.onError)
      .finally(() => {
        running = undefined
      })
  }
  return {
    start() {
      if (timer) return
      timer = setInterval(tick, options.intervalMs)
      timer.unref()
    },
    async stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      await running
    },
  }
}

/** For a module whose background work is switched off by configuration (for example billing without a payment provider). */
export const noJobs: ModuleJobs = { start() {}, async stop() {} }
