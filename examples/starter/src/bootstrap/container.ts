import { SystemClock, UuidV7Generator } from '@kit/core'
import { Database } from '@kit/db'
import { createMailer } from '@kit/mail'
import type { AppModule } from '@kit/runtime'
import { createRuntime } from '@kit/runtime'
import { createObjectStorage } from '@kit/storage'
import type { Logger } from '@kit/telemetry'
import { installIdentity } from '@mod/identity'
import { installProfile } from '@mod/profile'
import type { Config } from './config'
import { mailbox } from './mailbox'

/** Composition root: builds what modules share, installs them in order, and hands them to the runtime. */
export async function createContainer(config: Config, logger: Logger) {
  const clock = new SystemClock()
  const ids = new UuidV7Generator()
  const database = new Database({
    url: config.db.DATABASE_URL,
    poolMax: config.db.DB_POOL_MAX,
    prepare: config.db.DB_PREPARE,
  })
  const storage = createObjectStorage(config.storage)
  const mailer = createMailer(config.mail, logger)
  const host = { config, logger, clock, ids, database, storage, mailer }

  const installed: AppModule[] = [mailbox(config.core.WEB_APP_URL, logger)]
  const use = <M extends AppModule>(module: M) => {
    installed.push(module)
    return module
  }

  const identity = use(await installIdentity(host))
  const profile = use(installProfile({ ...host, modules: { identity } }))
  // <kit:install>

  // <kit:install-late>

  const modules = {
    identity,
    profile,
    // <kit:modules>
  } as const

  const runtime = createRuntime({
    modules: installed,
    database,
    logger,
    outbox: config.outbox,
    dbPoolMax: config.db.DB_POOL_MAX,
    maintenance: { pollIntervalMs: config.maintenance.MAINTENANCE_POLL_INTERVAL_MS },
  })

  return { config, logger, clock, ids, storage, database, modules, ...runtime }
}

export type Container = Awaited<ReturnType<typeof createContainer>>
