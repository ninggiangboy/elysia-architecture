import cluster from 'node:cluster'
import type { Logger } from '#/shared/infrastructure/logger'

const RESTART_DELAY_MS = 1000
/** More than this many crashes within the window means a crash loop: give up and let the orchestrator decide. */
const MAX_CRASHES = 5
const CRASH_WINDOW_MS = 60_000
const STOP_TIMEOUT_MS = 30_000

/**
 * Primary process of cluster mode: forks `processes` copies of this entrypoint (each with its own container, pool and
 * `reusePort` listener), keeps each slot filled, and forwards termination to them. It never touches the database.
 * Resolves once every process has exited after a shutdown signal.
 */
export function superviseProcesses(processes: number, logger: Logger): Promise<number> {
  return new Promise((resolve) => {
    const slots = new Map<number, number>() // cluster worker id → slot
    const crashes: number[] = []
    let stopping = false

    const fork = (slot: number) => {
      const worker = cluster.fork({ PROCESS_SLOT: String(slot) })
      slots.set(worker.id, slot)
    }

    const stop = (signal: NodeJS.Signals) => {
      if (stopping) return
      stopping = true
      logger.info({ signal, processes: slots.size }, 'cluster stopping')
      for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal)
      setTimeout(() => {
        logger.error('processes did not stop in time, killing')
        for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill('SIGKILL')
      }, STOP_TIMEOUT_MS).unref()
      if (slots.size === 0) resolve(0)
    }

    cluster.on('exit', (worker, code, signal) => {
      const slot = slots.get(worker.id) as number
      slots.delete(worker.id)
      if (stopping) {
        if (slots.size === 0) resolve(0)
        return
      }
      const now = Date.now()
      crashes.push(now)
      while (crashes[0] !== undefined && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift()
      logger.error({ slot, code, signal }, 'process exited unexpectedly')
      if (crashes.length > MAX_CRASHES) {
        logger.fatal({ crashes: crashes.length }, 'processes are crash-looping, shutting down')
        stop('SIGTERM')
        resolve(1)
        return
      }
      setTimeout(() => !stopping && fork(slot), RESTART_DELAY_MS)
    })

    process.on('SIGTERM', () => stop('SIGTERM'))
    process.on('SIGINT', () => stop('SIGINT'))

    for (let slot = 0; slot < processes; slot++) fork(slot)
    logger.info({ processes }, 'cluster started')
  })
}
