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

describe('APP_WORKERS', () => {
  test('defaults to a single process', () => {
    const config = loadConfig(base)
    expect(config.APP_WORKERS).toBe(1)
    expect(config.WORKER_SLOT).toBeUndefined()
  })

  test('accepts a number or auto', () => {
    expect(loadConfig({ ...base, APP_WORKERS: '4' }).APP_WORKERS).toBe(4)
    expect(loadConfig({ ...base, APP_WORKERS: 'auto' }).APP_WORKERS).toBe(
      Math.max(1, Math.floor((availableParallelism() * 3) / 4)),
    )
  })

  test('rejects zero and garbage', () => {
    expect(() => loadConfig({ ...base, APP_WORKERS: '0' })).toThrow('APP_WORKERS')
    expect(() => loadConfig({ ...base, APP_WORKERS: 'many' })).toThrow('APP_WORKERS')
  })
})
