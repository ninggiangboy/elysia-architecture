import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { outbox } from '#/modules/identity/infrastructure/persistence/schema'
import { OutboxRelay } from '#/shared/messaging'
import type { MaintenanceState } from '#/shared/runtime'
import { client, createTestApp, eventually, sleep, type TestApp } from './helpers'

// The flag comes from an in-memory store, not the database: toggling the real one would put any other process on this
// database (a running `bun run dev`) into maintenance mode too. The outbox rows below are real, so — as in the tracing
// test — another relay on the same database can publish them first; that only affects the "stays unpublished" checks.
const flag = { current: { active: false, reason: null, since: null } as MaintenanceState }
const setFlag = (active: boolean) => {
  flag.current = { active, reason: active ? 'test' : null, since: active ? new Date() : null }
}

let t: TestApp
let api: ReturnType<typeof client>

beforeAll(async () => {
  t = await createTestApp({ maintenanceStore: { read: async () => flag.current } })
  api = client(t.app)
})

const messageIds: string[] = []
afterAll(async () => {
  setFlag(false)
  for (const id of messageIds) await t.container.database.db.delete(outbox).where(eq(outbox.id, id))
  await t.container.close()
})

async function insertMessage() {
  const id = Bun.randomUUIDv7()
  messageIds.push(id)
  await t.container.database.db.insert(outbox).values({
    id,
    type: 'maintenance.test',
    aggregateId: id,
    payload: {},
    headers: {},
    occurredAt: new Date(),
  })
  return id
}

const publishedAt = async (id: string) =>
  (
    await t.container.database.db
      .select({ at: outbox.publishedAt })
      .from(outbox)
      .where(eq(outbox.id, id))
  )[0]?.at ?? null

describe('maintenance mode', () => {
  test('the API answers 503 except for the health probes, and recovers', async () => {
    expect((await api('GET', '/api/.well-known/jwks.json')).status).toBe(200)

    setFlag(true)
    await t.container.maintenance.refresh()

    const blocked = await api('GET', '/api/.well-known/jwks.json')
    expect(blocked.status).toBe(503)
    expect(blocked.json.error.code).toBe('maintenance')
    expect(blocked.headers.get('retry-after')).toBeTruthy()
    expect((await api('GET', '/api/health/live')).status).toBe(200)
    const ready = await api('GET', '/api/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.json).toMatchObject({ status: 'ready', maintenance: true })

    setFlag(false)
    await t.container.maintenance.refresh()
    expect((await api('GET', '/api/.well-known/jwks.json')).status).toBe(200)
    expect((await api('GET', '/api/health/ready')).json.maintenance).toBe(false)
  })

  test('the worker stops pulling while it is on and catches up when it ends', async () => {
    setFlag(true)
    await t.container.maintenance.refresh()
    // The switch is asynchronous (it waits for the batch in flight); let the relay settle before writing.
    await sleep(500)

    const id = await insertMessage()
    await sleep(1000) // several polls (the test app polls every 200 ms)
    expect(await publishedAt(id)).toBeNull()

    setFlag(false)
    await t.container.maintenance.refresh()
    await eventually(() => publishedAt(id), 10_000, 'the message to be published after maintenance')
  })
})

describe('OutboxRelay.pause', () => {
  test('waits for the batch in flight, then pulls nothing until resumed', async () => {
    const received: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const relay = new OutboxRelay(
      t.container.database,
      [t.container.modules.identity.outbox],
      {
        publish: async (envelope) => {
          if (envelope.type !== 'maintenance.test') return
          received.push(envelope.id)
          await gate // a slow handler
        },
      },
      t.container.logger,
      { pollIntervalMs: 20 },
    )
    // Keep the container's own relay out of the way, otherwise it may take the message first.
    await t.container.relay.pause()
    relay.start()

    const first = await insertMessage()
    await eventually(async () => received.includes(first), 5000, 'the first message to be handled')

    let paused = false
    const pausing = relay.pause().then(() => {
      paused = true
    })
    await sleep(150)
    expect(paused).toBe(false) // still waiting for the slow handler: nothing is cut short

    release()
    await pausing
    expect(await publishedAt(first)).not.toBeNull() // the batch was finished, not abandoned

    const second = await insertMessage()
    await sleep(300)
    expect(received).not.toContain(second)

    relay.resume()
    await eventually(async () => received.includes(second), 5000, 'the second message after resume')
    await relay.stop()
    t.container.relay.resume()
  })
})
