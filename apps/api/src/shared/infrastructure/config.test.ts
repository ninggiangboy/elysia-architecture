import { describe, expect, test } from 'bun:test'
import { availableParallelism } from 'node:os'
import { loadConfig } from './config'

const base = {
  DATABASE_URL: 'postgres://x',
  JWT_PRIVATE_KEY: 'k',
  JWT_PUBLIC_KEY: 'k',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 's',
}

describe('APP_PROCESSES', () => {
  test('defaults to a single process', () => {
    const config = loadConfig(base)
    expect(config.APP_PROCESSES).toBe(1)
    expect(config.PROCESS_SLOT).toBeUndefined()
  })

  test('accepts a number or auto', () => {
    expect(loadConfig({ ...base, APP_PROCESSES: '4' }).APP_PROCESSES).toBe(4)
    expect(loadConfig({ ...base, APP_PROCESSES: 'auto' }).APP_PROCESSES).toBe(
      Math.max(2, Math.floor((availableParallelism() * 3) / 4)),
    )
  })

  test('rejects zero and garbage', () => {
    expect(() => loadConfig({ ...base, APP_PROCESSES: '0' })).toThrow('APP_PROCESSES')
    expect(() => loadConfig({ ...base, APP_PROCESSES: 'many' })).toThrow('APP_PROCESSES')
  })
})

describe('APP_ROLES', () => {
  test('defaults to api and worker', () => {
    expect(loadConfig(base).APP_ROLES).toEqual(['api', 'worker'])
  })

  test('accepts either role alone', () => {
    expect(loadConfig({ ...base, APP_ROLES: 'worker' }).APP_ROLES).toEqual(['worker'])
    expect(loadConfig({ ...base, APP_ROLES: 'api' }).APP_ROLES).toEqual(['api'])
  })

  test('rejects an unknown role, including the old name relay', () => {
    expect(() => loadConfig({ ...base, APP_ROLES: 'cron' })).toThrow('APP_ROLES')
    expect(() => loadConfig({ ...base, APP_ROLES: 'api,relay' })).toThrow('APP_ROLES')
  })
})
