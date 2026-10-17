import { afterEach, describe, expect, test } from 'bun:test'
import {
  maintenanceStore,
  resetMaintenance,
  watchNetworkFailure,
  watchResponse,
} from './maintenance'

const realFetch = globalThis.fetch
// `apiOrigin()` falls back to the page's origin.
;(globalThis as { window?: unknown }).window = { location: { origin: 'http://web.test' } }

afterEach(() => {
  resetMaintenance()
  globalThis.fetch = realFetch
  ;(globalThis as { navigator?: unknown }).navigator = undefined
})

const maintenanceResponse = () =>
  new Response(JSON.stringify({ error: { code: 'maintenance', message: 'x' } }), { status: 503 })

type Answer = () => Response
const down: Answer = () => {
  throw new Error('connection refused')
}
const badGateway: Answer = () => new Response('<html>502</html>', { status: 502 })
const ready =
  (maintenance: boolean): Answer =>
  () =>
    Response.json({ status: 'ready', maintenance })

/** Fakes `/health/ready`: one answer per probe, the last one repeating. */
function health(...answers: Answer[]) {
  const probes = { count: 0 }
  globalThis.fetch = (async () =>
    answers[Math.min(probes.count++, answers.length - 1)]?.()) as unknown as typeof fetch
  return probes
}

describe('a 503 maintenance answer', () => {
  test('opens the dialog at once, without consuming the body', async () => {
    health(ready(true))
    const res = maintenanceResponse()
    await watchResponse(res, 5)
    expect(maintenanceStore.get()).toBe('maintenance')
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('maintenance')
  })

  test('stays up while the server is down or still in maintenance, closes when it says it is over', async () => {
    const probes = health(down, ready(true), ready(false))
    await watchResponse(maintenanceResponse(), 5)
    await Bun.sleep(12)
    expect(maintenanceStore.get()).toBe('maintenance')
    await Bun.sleep(60)
    expect(maintenanceStore.get()).toBeNull()
    expect(probes.count).toBe(3)
  })

  test('tells subscribers when it flips', async () => {
    health(ready(false))
    const seen: (string | null)[] = []
    const off = maintenanceStore.subscribe(() => seen.push(maintenanceStore.get()))
    await watchResponse(maintenanceResponse(), 5)
    await Bun.sleep(30)
    off()
    expect(seen).toEqual(['maintenance', null])
  })
})

describe('answers that are not ours', () => {
  test("ordinary answers, and the API's own 5xx errors, are left alone without any probing", async () => {
    const probes = health(down)
    await watchResponse(new Response('{"error":{"code":"internal_error"}}', { status: 500 }), 5)
    await watchResponse(new Response('{}', { status: 200 }), 5)
    await watchResponse(new Response('{}', { status: 404 }), 5)
    expect(maintenanceStore.get()).toBeNull()
    expect(probes.count).toBe(0)
  })

  test.each([502, 503, 504])('a bare %i with a healthy API shows nothing', async (status) => {
    health(ready(false))
    await watchResponse(new Response('<html>proxy</html>', { status }), 5)
    expect(maintenanceStore.get()).toBeNull()
  })

  test("the dev proxy's empty 500 counts as a proxy talking", async () => {
    health(down)
    await watchResponse(new Response('', { status: 500 }), 5)
    expect(maintenanceStore.get()).toBe('unavailable')
  })

  test('a bare 502 with the API really down is confirmed by a second probe, then shown as unavailable', async () => {
    const probes = health(down)
    await watchResponse(badGateway(), 5)
    expect(probes.count).toBe(2)
    expect(maintenanceStore.get()).toBe('unavailable')
  })

  test('one failed probe is a blip: if the next one is fine nothing is shown', async () => {
    health(down, ready(false))
    await watchResponse(badGateway(), 5)
    expect(maintenanceStore.get()).toBeNull()
  })

  test('unavailable closes once the API is back, and becomes maintenance if that is what it reports', async () => {
    health(down, down, ready(true), ready(true), ready(false))
    await watchResponse(badGateway(), 5)
    expect(maintenanceStore.get()).toBe('unavailable')
    await Bun.sleep(12)
    expect(maintenanceStore.get()).toBe('maintenance')
    await Bun.sleep(40)
    expect(maintenanceStore.get()).toBeNull()
  })

  test('maintenance is never downgraded to unavailable while the API restarts', async () => {
    health(down)
    await watchResponse(maintenanceResponse(), 5)
    await watchResponse(badGateway(), 5)
    await Bun.sleep(30)
    expect(maintenanceStore.get()).toBe('maintenance')
  })
})

describe('requests that got no answer', () => {
  test('a network failure with the API down shows the dialog', async () => {
    health(down)
    await watchNetworkFailure(new TypeError('Failed to fetch'), 5)
    expect(maintenanceStore.get()).toBe('unavailable')
  })

  test('a cancelled request is not a failure', async () => {
    const probes = health(down)
    await watchNetworkFailure(new DOMException('aborted', 'AbortError'), 5)
    expect(probes.count).toBe(0)
    expect(maintenanceStore.get()).toBeNull()
  })

  test('nothing is shown while the user is offline: that is their connection, not our deploy', async () => {
    const probes = health(down)
    ;(globalThis as { navigator?: unknown }).navigator = { onLine: false }
    await watchNetworkFailure(new TypeError('Failed to fetch'), 5)
    expect(probes.count).toBe(0)
    expect(maintenanceStore.get()).toBeNull()
  })

  test('many failures at once start one check, not one each', async () => {
    const probes = health(down)
    await Promise.all(Array.from({ length: 5 }, () => watchNetworkFailure(new TypeError('x'), 5)))
    expect(probes.count).toBe(2)
  })
})
