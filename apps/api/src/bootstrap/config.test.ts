import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { renderEnvExample } from '@kit/config'
import { CONFIG_SLICES, loadAppConfig } from './config'

const base = {
  DATABASE_URL: 'postgres://x',
  JWT_PRIVATE_KEY: 'k',
  JWT_PUBLIC_KEY: 'k',
  STEP_UP_CODE_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 's',
}

describe('loading', () => {
  test('hands each owner its own slice', () => {
    const config = loadAppConfig(base)
    expect(Object.keys(config)).toEqual(Object.keys(CONFIG_SLICES))
    expect(config.core.PORT).toBe(3000)
    expect(config.db.DATABASE_URL).toBe('postgres://x')
    expect('STRIPE_SECRET_KEY' in config.core).toBe(false)
  })

  test('reports every problem of every slice at once', () => {
    const error = (() => {
      try {
        loadAppConfig({ ...base, PORT: 'x', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk' })
      } catch (e) {
        return (e as Error).message
      }
    })()
    expect(error).toStartWith('Invalid configuration:')
    expect(error).toContain('PORT')
    expect(error).toContain('DATABASE_URL')
    expect(error).toContain('STRIPE_SECRET_KEY')
  })
})

describe('core', () => {
  test('APP_PROCESSES defaults to a single process', () => {
    const { core } = loadAppConfig(base)
    expect(core.APP_PROCESSES).toBe(1)
    expect(core.PROCESS_SLOT).toBeUndefined()
  })

  test('APP_PROCESSES accepts a number or auto', () => {
    expect(loadAppConfig({ ...base, APP_PROCESSES: '4' }).core.APP_PROCESSES).toBe(4)
    expect(loadAppConfig({ ...base, APP_PROCESSES: 'auto' }).core.APP_PROCESSES).toBe(
      Math.max(2, Math.floor((availableParallelism() * 3) / 4)),
    )
  })

  test('APP_PROCESSES rejects zero and garbage', () => {
    expect(() => loadAppConfig({ ...base, APP_PROCESSES: '0' })).toThrow('APP_PROCESSES')
    expect(() => loadAppConfig({ ...base, APP_PROCESSES: 'many' })).toThrow('APP_PROCESSES')
  })

  test('APP_ROLES defaults to api and worker, accepts either alone', () => {
    expect(loadAppConfig(base).core.APP_ROLES).toEqual(['api', 'worker'])
    expect(loadAppConfig({ ...base, APP_ROLES: 'worker' }).core.APP_ROLES).toEqual(['worker'])
    expect(loadAppConfig({ ...base, APP_ROLES: 'api' }).core.APP_ROLES).toEqual(['api'])
  })

  test('APP_ROLES rejects an unknown role, including the old name relay', () => {
    expect(() => loadAppConfig({ ...base, APP_ROLES: 'cron' })).toThrow('APP_ROLES')
    expect(() => loadAppConfig({ ...base, APP_ROLES: 'api,relay' })).toThrow('APP_ROLES')
  })
})

describe('.env.example', () => {
  test('is the one generated from the slices (run `bun run --filter @app/api config:example`)', () => {
    const path = new URL('../../../../.env.example', import.meta.url).pathname
    expect(readFileSync(path, 'utf8')).toBe(renderEnvExample(CONFIG_SLICES))
  })

  test('every variable has a description', () => {
    for (const [name, slice] of Object.entries(CONFIG_SLICES)) {
      const shape = (slice.schema as unknown as { shape: Record<string, { description?: string }> })
        .shape
      for (const [variable, field] of Object.entries(shape))
        expect(`${name}.${variable}: ${field.description ?? ''}`).not.toEndWith(': ')
    }
  })
})
