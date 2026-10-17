import { describe, expect, test } from 'bun:test'
import { availableParallelism } from 'node:os'
import { loadConfig } from './config'

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

describe('passkeys and OAuth', () => {
  test('WebAuthn defaults follow WEB_APP_URL', () => {
    const config = loadConfig({ ...base, WEB_APP_URL: 'https://app.example.com:8443/x' })
    expect(config.WEBAUTHN_RP_ID).toBe('app.example.com')
    expect(config.WEBAUTHN_ORIGINS).toEqual(['https://app.example.com:8443'])
  })

  test('WebAuthn can be pointed elsewhere', () => {
    const config = loadConfig({
      ...base,
      WEBAUTHN_RP_ID: 'example.com',
      WEBAUTHN_ORIGINS: 'https://a.example.com, https://b.example.com',
    })
    expect(config.WEBAUTHN_RP_ID).toBe('example.com')
    expect(config.WEBAUTHN_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  test('an OAuth provider needs both its id and its secret', () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow('GOOGLE_CLIENT_SECRET')
    expect(() => loadConfig({ ...base, GITHUB_CLIENT_SECRET: 's' })).toThrow('GITHUB_CLIENT_ID')
    expect(
      loadConfig({ ...base, GITHUB_CLIENT_ID: 'i', GITHUB_CLIENT_SECRET: 's' }).GITHUB_CLIENT_ID,
    ).toBe('i')
    expect(
      loadConfig({ ...base, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).GOOGLE_CLIENT_ID,
    ).toBeUndefined()
  })

  test('the confirmation window defaults to five minutes', () => {
    expect(loadConfig(base).STEP_UP_TTL).toBe(300)
    expect(loadConfig({ ...base, STEP_UP_TTL: '2m' }).STEP_UP_TTL).toBe(120)
  })
})

describe('top-ups', () => {
  const stripe = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  }

  test('Stripe is off unless its three values are set together', () => {
    expect(loadConfig(base).STRIPE_SECRET_KEY).toBeUndefined()
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(
      'must be set together',
    )
    expect(() => loadConfig({ ...base, ...stripe, STRIPE_WEBHOOK_SECRET: '' })).toThrow(
      'must be set together',
    )
    expect(loadConfig({ ...base, ...stripe }).STRIPE_WEBHOOK_SECRET).toBe('whsec_x')
    expect(
      loadConfig({ ...base, STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '' }).STRIPE_SECRET_KEY,
    ).toBeUndefined()
  })

  test('currencies default to all known ones and reject an unknown code', () => {
    expect(loadConfig(base).TOPUP_CURRENCIES).toEqual(['usd', 'eur', 'vnd'])
    expect(loadConfig({ ...base, TOPUP_CURRENCIES: 'vnd, usd' }).TOPUP_CURRENCIES).toEqual([
      'vnd',
      'usd',
    ])
    expect(() => loadConfig({ ...base, TOPUP_CURRENCIES: 'xyz' })).toThrow('TOPUP_CURRENCIES')
  })
})
