import { describe, expect, test } from 'bun:test'
import { buildApp } from '#/app'
import { loadAppConfig } from '#/bootstrap/config'
import { createContainer } from '#/bootstrap/container'
import { API_PREFIX } from '#/shared/http/constants'
import { createLogger } from '#/shared/infrastructure/logger'

describe('buildApp', () => {
  // app.ts mounts each module with a static `.use(...)` so Eden can infer the client types; a loop would lose them.
  // The price is that a module can be forgotten there, which this test catches.
  test('mounts every route of every module', async () => {
    const container = await createContainer(
      loadAppConfig({ ...process.env, LOG_LEVEL: 'silent' }),
      createLogger('silent'),
    )
    try {
      const mounted = new Set(buildApp(container).routes.map((r) => `${r.method} ${r.path}`))
      for (const module of Object.values(container.modules)) {
        const routes = (module.routes as { routes: { method: string; path: string }[] }).routes
        expect(routes.length).toBeGreaterThan(0)
        for (const route of routes)
          expect(mounted.has(`${route.method} ${API_PREFIX}${route.path}`)).toBe(true)
      }
    } finally {
      await container.close()
    }
  })
})
