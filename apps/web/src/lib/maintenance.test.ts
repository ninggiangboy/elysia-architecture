import { afterEach, describe, expect, test } from 'bun:test'
import { maintenanceStore, reportIfMaintenance, resetMaintenance } from './maintenance'

const realFetch = globalThis.fetch
// `apiOrigin()` falls back to the page's origin.
;(globalThis as { window?: unknown }).window = { location: { origin: 'http://web.test' } }
afterEach(() => {
  resetMaintenance()
  globalThis.fetch = realFetch
})

const maintenanceResponse = () =>
  new Response(JSON.stringify({ error: { code: 'maintenance', message: 'x' } }), { status: 503 })

describe('maintenance mode in the web app', () => {
  test('a 503 maintenance answer turns it on, without consuming the body', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch
    const res = maintenanceResponse()
    await reportIfMaintenance(res, 5)
    expect(maintenanceStore.get()).toBe(true)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('maintenance')
  })

  test('other answers do not', async () => {
    await reportIfMaintenance(new Response('{"error":{"code":"internal_error"}}', { status: 500 }))
    await reportIfMaintenance(new Response('{"error":{"code":"maintenance"}}', { status: 200 }))
    await reportIfMaintenance(new Response('<html>bad gateway</html>', { status: 503 }))
    expect(maintenanceStore.get()).toBe(false)
  })

  test('stays on while the server is down or still in maintenance, goes off when it says so', async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new Error('connection refused') // the app is restarting
      },
      () => Response.json({ status: 'ready', maintenance: true }), // up again, deploy not finished
      () => Response.json({ status: 'ready', maintenance: false }),
    ]
    let asked = 0
    globalThis.fetch = (async () =>
      answers[Math.min(asked++, answers.length - 1)]?.()) as unknown as typeof fetch

    await reportIfMaintenance(maintenanceResponse(), 5)
    await Bun.sleep(12)
    expect(maintenanceStore.get()).toBe(true)
    await Bun.sleep(60)
    expect(maintenanceStore.get()).toBe(false)
    expect(asked).toBe(3)
  })

  test('tells subscribers when it flips', async () => {
    globalThis.fetch = (async () =>
      Response.json({ maintenance: false })) as unknown as typeof fetch
    const seen: boolean[] = []
    const off = maintenanceStore.subscribe(() => seen.push(maintenanceStore.get()))
    await reportIfMaintenance(maintenanceResponse(), 5)
    await Bun.sleep(30)
    off()
    expect(seen).toEqual([true, false])
  })
})
