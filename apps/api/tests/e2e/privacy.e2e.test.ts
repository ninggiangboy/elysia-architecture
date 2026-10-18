import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  AccountDeletion,
  DataExport,
  DrizzleAccountDeletionRepository,
  DrizzleDataExportRepository,
} from '@mod/privacy/testing'
import { sql } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import {
  client,
  createTestApp,
  eventually,
  login,
  mailsTo,
  openSse,
  PNG_1X1,
  type TestApp,
  uniqueEmail,
  waitForMail,
} from './helpers'

let t: TestApp
let api: ReturnType<typeof client>

beforeAll(async () => {
  t = await createTestApp(
    {},
    {
      // Short enough to wait for, long enough that nothing is erased while a test is still setting up.
      PRIVACY_DELETION_GRACE_PERIOD: '3s',
      PRIVACY_JOBS_INTERVAL_SECONDS: '1',
      PRIVACY_MAX_NUDGES: '1',
    },
  )
  api = client(t.app)
})

afterAll(async () => {
  await t.container.close()
})

const count = async (query: ReturnType<typeof sql>) =>
  (await t.container.database.db.execute<{ n: number }>(query))[0]?.n ?? 0

/** Signs up, gives the account a display name and an avatar, and waits for the sign-up notification. */
async function signUpWithData(tag: string) {
  const email = uniqueEmail(tag)
  const me = await login(api, email)
  const token = me.accessToken
  // The profile is created from the sign-up event; patching before it exists races with that handler.
  const profileVersion = await eventually(async () => {
    const me2 = await api('GET', '/api/me', { token })
    return me2.json.version > 0 ? me2.json.version : undefined
  })
  const patched = await api('PATCH', '/api/me/profile', {
    token,
    headers: { 'if-match': String(profileVersion) },
    body: { displayName: `Name of ${tag}`, bio: 'Hello there' },
  })
  if (patched.status !== 200) throw new Error(`profile not updated: ${patched.status}`)
  const ticket = await api('POST', '/api/me/avatar/upload-url', {
    token,
    body: { contentType: 'image/png', contentLength: PNG_1X1.length },
  })
  await fetch(ticket.json.uploadUrl, { method: 'PUT', headers: ticket.json.headers, body: PNG_1X1 })
  const set = await api('PUT', '/api/me/avatar', { token, body: { key: ticket.json.key } })
  if (set.status !== 200) throw new Error(`avatar not set: ${set.status}`)
  await eventually(
    async () => (await api('GET', '/api/notifications/unread-count', { token })).json.count >= 1,
    10_000,
    'welcome notification',
  )
  return { ...me, email, avatarKey: ticket.json.key as string }
}

/** The link in the mail, however the client renders it. */
const linkIn = (text: string) => text.match(/https?:\/\/\S+/)?.[0] as string

describe('data export', () => {
  test('collects every module into a zip, mails the link and notifies — and is guarded by step-up', async () => {
    const me = await signUpWithData('export')

    // A token from a plain refresh carries no recent confirmation.
    const refreshed = await api('POST', '/api/auth/refresh', { cookie: me.cookie })
    const weak = await api('POST', '/api/privacy/exports', { token: refreshed.json.accessToken })
    expect(weak.status).toBe(403)
    expect(weak.json.error.code).toBe('step_up_required')

    const sse = await openSse(t.app, me.accessToken)
    await sse.next('ready')

    const started = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    expect(started.status).toBe(202)
    expect(started.json.modules.map((m: { module: string }) => m.module)).toEqual([
      'billing',
      'identity',
      'notification',
      'profile',
    ])
    const again = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    expect(again.status).toBe(409)
    expect(again.json.error.code).toBe('export_in_progress')

    // Progress arrives live, step by step, then the end.
    const ready = await sse.next('privacy.export.ready', (m) => m.data.exportId === started.json.id)
    const progress = sse.received.filter((m) => m.type === 'privacy.export.progress')
    // Delivery order across relay instances is not guaranteed, which is why `done` is a count, not a step number.
    expect(progress.map((m) => m.data.done).sort()).toEqual([1, 2, 3, 4])
    expect(progress.every((m) => m.id !== '')).toBe(true) // replayable: they have an id
    sse.close()

    const view = await eventually(async () => {
      const r = await api('GET', `/api/privacy/exports/${started.json.id}`, {
        token: me.accessToken,
      })
      return r.json.status === 'ready' ? r.json : undefined
    })
    expect(view.progress).toEqual({ done: 4, total: 4 })
    expect(view.size).toBe(ready.data.size)

    // The mail carries a working link to the archive.
    const mail = await waitForMail(me.email, 'data export')
    const archive = unzipSync(new Uint8Array(await (await fetch(linkIn(mail.text))).arrayBuffer()))
    expect(Object.keys(archive).sort()).toEqual([
      'README.txt',
      'data/billing.json',
      'data/identity.json',
      'data/notification.json',
      'data/profile.json',
      'files/profile/avatar.png',
    ])
    const read = (name: string) => JSON.parse(new TextDecoder().decode(archive[name]))
    expect(read('data/identity.json').account).toMatchObject({ id: me.userId, email: me.email })
    expect(read('data/profile.json').profile).toMatchObject({
      displayName: 'Name of export',
      bio: 'Hello there',
      avatar: 'profile/avatar.png',
    })
    expect(
      read('data/notification.json').notifications.map((n: { kind: string }) => n.kind),
    ).toContain('welcome')
    expect([...(archive['files/profile/avatar.png'] ?? [])]).toEqual([...PNG_1X1])

    // The in-app notification points to the privacy page and never holds the link.
    const notice = await eventually(async () => {
      const list = await api('GET', '/api/notifications', { token: me.accessToken })
      return list.json.items.find((n: { kind: string }) => n.kind === 'data_export')
    })
    expect(notice).toMatchObject({
      template: 'dataExportReady',
      data: { link: '/settings/account' },
    })
    expect(JSON.stringify(notice)).not.toContain('http')

    // A fresh link on demand — also behind step-up, and only for the owner.
    const download = await api('GET', `/api/privacy/exports/${started.json.id}/download`, {
      token: me.accessToken,
    })
    expect(download.status).toBe(200)
    expect((await fetch(download.json.url)).status).toBe(200)
    const weakDownload = await api('GET', `/api/privacy/exports/${started.json.id}/download`, {
      token: refreshed.json.accessToken,
    })
    expect(weakDownload.status).toBe(403)
    const stranger = await login(api, uniqueEmail('stranger'))
    const foreign = await api('GET', `/api/privacy/exports/${started.json.id}`, {
      token: stranger.accessToken,
    })
    expect(foreign.status).toBe(404)
  })

  test('a client that was offline replays the steps of the job it missed', async () => {
    const me = await signUpWithData('replay')
    const first = await openSse(t.app, me.accessToken)
    const hello = await first.next('ready')
    first.close()

    const started = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    await eventually(async () => {
      const r = await api('GET', `/api/privacy/exports/${started.json.id}`, {
        token: me.accessToken,
      })
      return r.json.status === 'ready'
    })

    const second = await openSse(t.app, me.accessToken, {
      lastEventId: String(hello.data.cursor),
    })
    const resumed = await second.next('ready')
    expect(resumed.data.resumed).toBe(true)
    await second.next('privacy.export.ready', (m) => m.data.exportId === started.json.id)
    expect(second.received.filter((m) => m.type === 'privacy.export.progress')).toHaveLength(4)
    second.close()
  })
})

describe('account deletion', () => {
  test('waits out the grace period, then every module erases its data and the user is told', async () => {
    const me = await signUpWithData('delete')
    // Something in privacy's own tables to be erased too.
    const exported = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    await eventually(async () => {
      const r = await api('GET', `/api/privacy/exports/${exported.json.id}`, {
        token: me.accessToken,
      })
      return r.json.status === 'ready'
    })
    expect(
      await t.container.storage.stat(`exports/${me.userId}/${exported.json.id}/archive.zip`),
    ).not.toBeNull()
    expect(await t.container.storage.stat(me.avatarKey)).not.toBeNull()

    const weak = await api('POST', '/api/auth/refresh', { cookie: me.cookie })
    expect(
      (await api('POST', '/api/privacy/deletion', { token: weak.json.accessToken })).json.error
        .code,
    ).toBe('step_up_required')

    const sse = await openSse(t.app, me.accessToken)
    await sse.next('ready')

    const scheduled = await api('POST', '/api/privacy/deletion', { token: me.accessToken })
    expect(scheduled.status).toBe(202)
    expect(scheduled.json.status).toBe('scheduled')
    const current = await api('GET', '/api/privacy/deletion', { token: me.accessToken })
    expect(current.json.deletion).toMatchObject({ id: scheduled.json.id, status: 'scheduled' })
    expect(
      (await api('POST', '/api/privacy/deletion', { token: me.accessToken })).json.error.code,
    ).toBe('deletion_already_scheduled')

    // Told straight away, and by the account's own notifications.
    const mail = await waitForMail(me.email, 'scheduled for deletion')
    expect(mail.text).toContain('/settings/account')
    await eventually(async () => {
      const list = await api('GET', '/api/notifications', { token: me.accessToken })
      return list.json.items.some((n: { template: string }) => n.template === 'deletionScheduled')
    })
    // Nothing erased yet.
    expect(
      await count(sql`select count(*)::int as n from identity.users where id = ${me.userId}`),
    ).toBe(1)

    // …until the grace period is over.
    const goodbye = await waitForMail(me.email, 'has been deleted')
    expect(goodbye.text).toContain(me.email)

    const progress = sse.received.filter((m) => m.type === 'privacy.deletion.progress')
    expect(progress.map((m) => m.data.module).sort()).toEqual([
      'billing',
      'identity',
      'notification',
      'privacy',
      'profile',
    ])
    sse.close()

    // Every module's data is gone.
    const userId = me.userId
    const leftovers: Record<string, ReturnType<typeof sql>> = {
      'identity.users': sql`select count(*)::int as n from identity.users where id = ${userId}`,
      'identity.refresh_tokens': sql`select count(*)::int as n from identity.refresh_tokens where user_id = ${userId}`,
      'identity.magic_links': sql`select count(*)::int as n from identity.magic_links where email = ${me.email}`,
      'profile.profiles': sql`select count(*)::int as n from profile.profiles where user_id = ${userId}`,
      'notification.notifications': sql`select count(*)::int as n from notification.notifications where user_id = ${userId}`,
      'privacy.export_requests': sql`select count(*)::int as n from privacy.export_requests where user_id = ${userId}`,
      // The module's own confirmation (ids and a time, no personal data) is the one message that must remain.
      'identity.outbox (published)': sql`select count(*)::int as n from identity.outbox_messages where aggregate_id = ${userId} and published_at is not null and type <> 'identity.user_data_erased.v1'`,
      // Purged when the account is deleted. A progress event still in flight on another relay can land after the purge:
      // it holds only module names and counts, and the replay window prunes it on its own.
      'realtime.events': sql`select count(*)::int as n from realtime.events where user_id = ${userId} and type <> 'privacy.deletion.progress'`,
    }
    const remaining: Record<string, number> = {}
    for (const [table, query] of Object.entries(leftovers)) remaining[table] = await count(query)
    expect(remaining).toEqual(Object.fromEntries(Object.keys(leftovers).map((k) => [k, 0])))
    expect(await t.container.storage.stat(me.avatarKey)).toBeNull()
    expect(
      await t.container.storage.stat(`exports/${userId}/${exported.json.id}/archive.zip`),
    ).toBeNull()

    // The ledger of the erasure stays — without the address.
    const [row] = await t.container.database.db.execute<{ status: string; email: string | null }>(
      sql`select status, email from privacy.account_deletions where id = ${scheduled.json.id}`,
    )
    expect(row).toEqual({ status: 'completed', email: null })

    // The token still verifies (it is stateless) but there is nobody behind it.
    const gone = await api('GET', '/api/me', { token: me.accessToken })
    expect(gone.status).toBe(404)
    // Signing up again with the same address is a new account.
    const reborn = await login(api, me.email)
    expect(reborn.userId).not.toBe(userId)
  })

  test('can be cancelled during the grace period', async () => {
    // A long grace period, so there is time to change one's mind.
    const slow = await createTestApp({}, { PRIVACY_DELETION_GRACE_PERIOD: '1h' })
    try {
      const slowApi = client(slow.app)
      const email = uniqueEmail('cancel')
      const me = await login(slowApi, email)
      await slowApi('POST', '/api/privacy/deletion', { token: me.accessToken })
      await waitForMail(email, 'scheduled for deletion')

      const cancelled = await slowApi('DELETE', '/api/privacy/deletion', { token: me.accessToken })
      expect(cancelled.status).toBe(204)
      expect(
        (await slowApi('GET', '/api/privacy/deletion', { token: me.accessToken })).json,
      ).toEqual({
        deletion: null,
      })
      await waitForMail(email, 'deletion cancelled')
      expect(
        (await slowApi('DELETE', '/api/privacy/deletion', { token: me.accessToken })).json.error
          .code,
      ).toBe('no_deletion_scheduled')
      expect(await slowApi('GET', '/api/me', { token: me.accessToken })).toMatchObject({
        status: 200,
      })
      expect(await mailsTo(email)).not.toHaveLength(0)
    } finally {
      await slow.container.close()
    }
  })
})

describe('jobs on the real tables', () => {
  const newUserId = () => crypto.randomUUID()

  test('an erasure whose module never answers is re-sent, then stalls, and can be resumed', async () => {
    const database = t.container.database
    const deletions = new DrizzleAccountDeletionRepository(database)
    const userId = newUserId()
    const deletion = AccountDeletion.schedule({
      id: crypto.randomUUID(),
      userId,
      email: 'nobody@example.test',
      locale: 'en',
      now: new Date(Date.now() - 3600_000),
      gracePeriodMs: 1000,
    })
    await deletions.add(deletion)

    const run = async () => {
      const report = await t.container.modules.privacy.runJobs()
      return report
    }
    const statusOf = async () => (await deletions.findById(deletion.id))?.status

    // Due → started, with a step for a module that does not exist anywhere (it never answers).
    await eventually(async () => {
      await run()
      return (await statusOf()) !== 'scheduled'
    })
    const started = (await deletions.findById(deletion.id))!
    // Pretend the module is a service that is down: remove the real participants' steps and add the missing one.
    started.props.steps = [{ module: 'ghost', confirmed: false, confirmedAt: null }]
    started.props.updatedAt = new Date(Date.now() - 3600_000)
    await deletions.save(started)
    await database.db.execute(
      sql`delete from privacy.deletion_steps where deletion_id = ${deletion.id} and module <> 'ghost'`,
    )

    // Quiet for an hour: re-sent once (PRIVACY_MAX_NUDGES = 1), then given up on.
    await eventually(async () => {
      await database.db.execute(
        sql`update privacy.account_deletions set updated_at = now() - interval '1 hour' where id = ${deletion.id} and status = 'running'`,
      )
      await run()
      return (await statusOf()) === 'stalled'
    }, 20_000)
    const stalled = await deletions.findById(deletion.id)
    expect(stalled?.pendingModules()).toEqual(['ghost'])
    const asked = await database.db.execute<{ payload: { modules: string[]; attempt: number } }>(
      sql`select payload from privacy.outbox_messages where type = 'privacy.account_erasure_requested.v1' and aggregate_id = ${userId} order by id`,
    )
    const modulesAsked = asked.map((r) => r.payload.modules)
    expect(modulesAsked[0]).toEqual(['billing', 'identity', 'notification', 'privacy', 'profile'])
    // Re-sent only to the module that had not answered.
    expect(modulesAsked.length).toBeGreaterThanOrEqual(2)
    expect(modulesAsked.slice(1).every((m) => m.join() === 'ghost')).toBe(true)
    expect(
      await count(
        sql`select count(*)::int as n from privacy.outbox_messages where type = 'privacy.account_deletion_stalled.v1' and aggregate_id = ${userId}`,
      ),
    ).toBe(1)

    // An operator fixes the module and resumes the job: another round goes out to the one still owed.
    await t.container.modules.privacy.resumeDeletion(deletion.id)
    expect((await deletions.findById(deletion.id))?.status).toBe('running')
    const resumed = await database.db.execute<{ payload: { modules: string[] } }>(
      sql`select payload from privacy.outbox_messages where type = 'privacy.account_erasure_requested.v1' and aggregate_id = ${userId} order by id desc limit 1`,
    )
    expect(resumed[0]?.payload.modules).toEqual(['ghost'])

    // Leave nothing behind: a deletion waiting forever for a module that does not exist would be nudged by every worker.
    await database.db.execute(sql`delete from privacy.account_deletions where id = ${deletion.id}`)
  })

  test('an export whose module never answers is re-sent and then fails; the user can ask again', async () => {
    const database = t.container.database
    const exports = new DrizzleDataExportRepository(database)
    const me = await login(api, uniqueEmail('stuck-export'))
    const stuck = DataExport.request({
      id: crypto.randomUUID(),
      userId: me.userId,
      modules: ['ghost'],
      now: new Date(Date.now() - 3600_000),
    })
    await exports.add(stuck)
    // One export at a time, enforced by the database.
    const blocked = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    expect(blocked.json.error.code).toBe('export_in_progress')

    await eventually(async () => {
      await database.db.execute(
        sql`update privacy.export_requests set updated_at = now() - interval '1 hour' where id = ${stuck.id} and status = 'collecting'`,
      )
      await t.container.modules.privacy.runJobs()
      return (await exports.findById(stuck.id))?.status === 'failed'
    }, 20_000)
    expect((await exports.findById(stuck.id))?.props.failureReason).toContain('did not deliver')
    await eventually(async () => {
      const list = await api('GET', '/api/notifications', { token: me.accessToken })
      return list.json.items.some((n: { template: string }) => n.template === 'dataExportFailed')
    })
    const retry = await api('POST', '/api/privacy/exports', { token: me.accessToken })
    expect(retry.status).toBe(202)
  })
})
