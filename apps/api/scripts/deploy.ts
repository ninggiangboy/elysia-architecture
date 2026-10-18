// Deploy flow with a soft stop:
//   bun scripts/deploy.ts [deploy]          maintenance on → soft stop → migrate → start → health → maintenance off
//   bun scripts/deploy.ts maintenance <on|off|status> [--reason "..."]
//   bun scripts/deploy.ts <start|stop|status>   the local stand-in for the container runtime (see `LocalRuntime`)
//
// Flags: --stop-timeout <s> (default 60)  --health-timeout <s> (default 60)
//
// Safe to run again after any failure: every step is idempotent, and a failed deploy leaves maintenance mode ON on purpose
// (a half-deployed app must not take traffic). `maintenance off` is the way out if you decide to abandon it.
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Database } from '@kit/db'
import { sql } from 'drizzle-orm'
import { MaintenanceStore } from '#/shared/runtime'

const root = join(import.meta.dir, '..')
const env = process.env as Record<string, string | undefined>
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
// Everything that is not `--name value`: the command, then its argument.
const positional = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'))
const [command = 'deploy'] = positional
const seconds = (name: string, fallback: number) => Number(flag(name) ?? fallback) * 1000

const STOP_TIMEOUT_MS = seconds('stop-timeout', 60)
const HEALTH_TIMEOUT_MS = seconds('health-timeout', 60)
const POLL_MS = Number(env.MAINTENANCE_POLL_INTERVAL_MS ?? 1000)
const HEALTH_URL = `http://127.0.0.1:${env.PORT ?? 3000}/api/health/ready`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (message: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)}  ${message}`)

class DeployError extends Error {}

// ---- The runtime: what stops and starts the app. In production this is `docker stop` / `docker run` of the new image. ----

/** Runs `src/main.ts` as a detached local process (pid file + log file in `.run/`). */
class LocalRuntime {
  private readonly dir = join(root, '.run')
  private readonly pidFile = join(this.dir, 'api.pid')
  readonly logFile = join(this.dir, 'api.log')

  get pid(): number | undefined {
    if (!existsSync(this.pidFile)) return undefined
    const pid = Number(readFileSync(this.pidFile, 'utf8'))
    return alive(pid) ? pid : undefined
  }

  start(): number {
    if (this.pid) throw new DeployError(`the app is already running (pid ${this.pid})`)
    mkdirSync(this.dir, { recursive: true })
    const out = openSync(this.logFile, 'a')
    const child = spawn('bun', [join(root, 'src', 'main.ts')], {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: ['ignore', out, out],
    })
    child.unref()
    closeSync(out)
    if (!child.pid) throw new DeployError('could not start the app')
    writeFileSync(this.pidFile, String(child.pid))
    return child.pid
  }

  /**
   * SIGTERM, then wait: the app finishes its in-flight requests and relay batch before it exits. There is deliberately no
   * SIGKILL here — cutting a request or a handler short is exactly what this flow exists to avoid. If the app does not
   * exit in time the deploy stops and a human looks at why.
   */
  async stop(timeoutMs: number): Promise<'stopped' | 'not running'> {
    const pid = this.pid
    if (!pid) {
      rmSync(this.pidFile, { force: true })
      return 'not running'
    }
    process.kill(pid, 'SIGTERM')
    const deadline = Date.now() + timeoutMs
    while (alive(pid)) {
      if (Date.now() > deadline)
        throw new DeployError(
          `pid ${pid} is still draining after ${timeoutMs / 1000}s (SIGTERM was sent, nothing was killed)`,
        )
      await sleep(200)
    }
    rmSync(this.pidFile, { force: true })
    return 'stopped'
  }

  tail(lines = 15): string {
    if (!existsSync(this.logFile)) return '(no log)'
    return readFileSync(this.logFile, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---- Health ----

interface Health {
  status: string
  maintenance?: boolean
}

async function health(): Promise<Health | undefined> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    return res.ok ? ((await res.json()) as Health) : undefined
  } catch {
    return undefined
  }
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined> | T | undefined,
  abort?: () => string | undefined,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await probe()
    if (found !== undefined) return found
    const reason = abort?.()
    if (reason) throw new DeployError(`${what}: ${reason}`)
    if (Date.now() > deadline)
      throw new DeployError(`${what}: not there after ${timeoutMs / 1000}s`)
    await sleep(500)
  }
}

// ---- Steps ----

const database = new Database({ url: env.DATABASE_URL, poolMax: 1, prepare: false })
const flagStore = new MaintenanceStore(database)
const runtime = new LocalRuntime()

async function deploy() {
  // One deploy at a time. A session lock on the (single) connection: it disappears with the process, so a crashed deploy
  // never leaves it behind.
  const [lock] = await database.db.execute<{ ok: boolean }>(
    sql`select pg_try_advisory_lock(hashtext('deploy')) as ok`,
  )
  if (!lock?.ok) throw new DeployError('another deploy is running')

  const total = 7
  const step = (n: number, what: string) => log(`[${n}/${total}] ${what}`)
  const started = Date.now()

  step(1, 'maintenance mode on')
  const before = await flagStore.read()
  if (before.active)
    log(
      `  already on since ${before.since?.toISOString()} (${before.reason ?? 'no reason'}), carrying on`,
    )
  await flagStore.write(true, 'deploy')

  step(2, 'waiting for the running app to stop taking requests and pulling from the outbox')
  if (runtime.pid) {
    // Every process polls the flag, so once one answers "maintenance" the rest follow within a poll; wait one more for them.
    // An app from before this feature never says so: carry on, the SIGTERM below still stops it softly.
    await waitFor('maintenance', 5 * POLL_MS, async () =>
      (await health())?.maintenance ? true : undefined,
    ).then(
      () => sleep(POLL_MS + 250),
      () => log('  the running app did not confirm maintenance mode (older build?), carrying on'),
    )
  } else log('  no app is running')

  step(3, 'soft stop (in-flight requests and the relay batch finish first)')
  log(`  ${await runtime.stop(STOP_TIMEOUT_MS)}`)

  step(4, 'migrations')
  const migrate = spawnSync('bun', [join(root, 'scripts', 'db.ts'), 'migrate'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (migrate.status !== 0) throw new DeployError('migrations failed')

  step(5, 'start the new version')
  const pid = runtime.start()
  log(`  pid ${pid}, log ${runtime.logFile}`)

  step(6, 'health check')
  // It must come up READY and already in maintenance mode: that proves the gate is on before a single request is let in.
  const up = await waitFor(
    'health',
    HEALTH_TIMEOUT_MS,
    async () => {
      const h = await health()
      return h?.status === 'ready' ? h : undefined
    },
    () => (alive(pid) ? undefined : 'the new process exited'),
  )
  if (up.maintenance !== true)
    throw new DeployError('the new app is ready but not in maintenance mode')
  log('  ready')

  step(7, 'maintenance mode off')
  await flagStore.write(false)
  await waitFor('reopening', 5 * POLL_MS + 5000, async () =>
    (await health())?.maintenance === false ? true : undefined,
  )
  log(`deployed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

async function maintenance() {
  const action = positional[1]
  if (action === 'on' || action === 'off') {
    const state = await flagStore.write(action === 'on', flag('reason') ?? 'manual')
    log(`maintenance ${state.active ? 'ON' : 'off'} (processes pick it up within ${POLL_MS}ms)`)
  } else if (action === 'status') {
    const state = await flagStore.read()
    log(state.active ? `ON since ${state.since?.toISOString()} (${state.reason})` : 'off')
  } else throw new DeployError('usage: maintenance <on|off|status> [--reason "..."]')
}

try {
  switch (command) {
    case 'deploy':
      await deploy()
      break
    case 'maintenance':
      await maintenance()
      break
    case 'start':
      log(`started, pid ${runtime.start()}, log ${runtime.logFile}`)
      break
    case 'stop':
      log(await runtime.stop(STOP_TIMEOUT_MS))
      break
    case 'status': {
      const h = await health()
      const state = await flagStore.read()
      log(
        `pid ${runtime.pid ?? '-'}  health ${h ? h.status : 'unreachable'}  maintenance ${state.active ? 'ON' : 'off'}`,
      )
      break
    }
    default:
      throw new DeployError(
        'usage: deploy.ts [deploy | maintenance <on|off|status> | start | stop | status]',
      )
  }
} catch (err) {
  if (!(err instanceof DeployError)) throw err
  console.error(`\n✖ ${err.message}`)
  if (command === 'deploy') {
    if (existsSync(runtime.logFile))
      console.error(`\nlast lines of the app log:\n${runtime.tail()}`)
    console.error(
      '\nMaintenance mode is still ON (a half-deployed app must not take traffic). Fix the cause and run the deploy again,' +
        '\nor abandon it with:  bun run deploy maintenance off',
    )
  }
  process.exitCode = 1
} finally {
  await database.close()
}
