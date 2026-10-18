// Privacy job operations:
//   bun scripts/privacy.ts list                      account deletions and data exports that are not finished
//   bun scripts/privacy.ts resume --id <deletion id> gives a stalled account deletion another round
// A deletion stalls when a module did not confirm its erasure even after the job was re-sent PRIVACY_MAX_NUDGES times.
// Fix why (the module's handler is failing, or its dead-lettered message needs `outbox:requeue`), then resume.
// Resuming only writes an event: a running worker's relay delivers it.
import { sql } from 'drizzle-orm'
import { loadAppConfig } from '#/bootstrap/config'
import { createContainer } from '#/bootstrap/container'
import { createLogger } from '#/shared/telemetry'

const [command, ...rest] = process.argv.slice(2)
const idFlag = rest.indexOf('--id')
const id = idFlag >= 0 ? rest[idFlag + 1] : undefined

if (command !== 'list' && !(command === 'resume' && id)) {
  console.error('Usage: bun scripts/privacy.ts list | resume --id <deletion id>')
  process.exit(1)
}

const container = await createContainer(loadAppConfig(), createLogger('silent'))
try {
  if (command === 'resume' && id) {
    await container.modules.privacy.resumeDeletion(id)
    console.log(`deletion ${id} resumed`)
  } else {
    const deletions = await container.database.db.execute<{
      id: string
      status: string
      scheduled_for: Date
      nudges: number
      pending: string | null
    }>(sql`
      select d.id, d.status, d.scheduled_for, d.nudges,
             string_agg(s.module, ',' order by s.module) filter (where not s.confirmed) as pending
      from privacy.account_deletions d
      left join privacy.deletion_steps s on s.deletion_id = d.id
      where d.status in ('scheduled', 'running', 'stalled')
      group by d.id order by d.scheduled_for`)
    for (const d of deletions)
      console.log(
        `deletion\t${d.id}\t${d.status}\tscheduled_for=${new Date(d.scheduled_for).toISOString()}\tnudges=${d.nudges}\tpending=${d.pending ?? '-'}`,
      )
    const exports = await container.database.db.execute<{
      id: string
      status: string
      nudges: number
      pending: string | null
    }>(sql`
      select e.id, e.status, e.nudges,
             string_agg(p.module, ',' order by p.module) filter (where not p.done) as pending
      from privacy.export_requests e
      left join privacy.export_parts p on p.export_id = e.id
      where e.status in ('collecting', 'assembling')
      group by e.id order by e.requested_at`)
    for (const e of exports)
      console.log(`export\t${e.id}\t${e.status}\tnudges=${e.nudges}\tpending=${e.pending ?? '-'}`)
    console.log(`${deletions.length} deletion(s), ${exports.length} export(s) not finished`)
  }
} finally {
  await container.close()
}
