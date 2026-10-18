import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { maintenancePlugin } from './maintenance.plugin'

function setup() {
  const mode = { active: false }
  const app = new Elysia({ prefix: '/api' })
    .use(maintenancePlugin(mode, 42))
    .get('/things', () => ({ ok: true }))
    .post('/billing/webhooks/stripe', () => ({ ok: true }))
    .get('/health/live', () => ({ status: 'ok' }))
    .get('/health/ready', () => ({ status: 'ready' }))
  const get = (path: string, method = 'GET') =>
    app.handle(new Request(`http://localhost/api${path}`, { method }))
  return { mode, get }
}

describe('maintenancePlugin', () => {
  test('lets everything through while maintenance is off', async () => {
    const { get } = setup()
    expect((await get('/things')).status).toBe(200)
  })

  test('answers 503 with Retry-After and an error body while it is on', async () => {
    const { mode, get } = setup()
    mode.active = true
    for (const res of [await get('/things'), await get('/billing/webhooks/stripe', 'POST')]) {
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBe('42')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('maintenance')
    }
  })

  test('keeps the health probes answering', async () => {
    const { mode, get } = setup()
    mode.active = true
    expect((await get('/health/live')).status).toBe(200)
    expect((await get('/health/ready')).status).toBe(200)
  })

  test('reopens as soon as the flag goes off', async () => {
    const { mode, get } = setup()
    mode.active = true
    expect((await get('/things')).status).toBe(503)
    mode.active = false
    expect((await get('/things')).status).toBe(200)
  })
})
