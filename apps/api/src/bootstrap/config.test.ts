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

describe('identity: passkeys and OAuth', () => {
  test('WebAuthn settings are left unset so the module can follow WEB_APP_URL', () => {
    const { identity } = loadAppConfig({ ...base, WEB_APP_URL: 'https://app.example.com:8443/x' })
    expect(identity.WEBAUTHN_RP_ID).toBeUndefined()
    expect(identity.WEBAUTHN_ORIGINS).toBeUndefined()
    expect(identity.WEB_APP_URL).toBe('https://app.example.com:8443/x')
  })

  test('WebAuthn can be pointed elsewhere', () => {
    const { identity } = loadAppConfig({
      ...base,
      WEBAUTHN_RP_ID: 'example.com',
      WEBAUTHN_ORIGINS: 'https://a.example.com, https://b.example.com',
    })
    expect(identity.WEBAUTHN_RP_ID).toBe('example.com')
    expect(identity.WEBAUTHN_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  test('an OAuth provider needs both its id and its secret', () => {
    expect(() => loadAppConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow('GOOGLE_CLIENT_ID')
    expect(() => loadAppConfig({ ...base, GITHUB_CLIENT_SECRET: 's' })).toThrow('GITHUB_CLIENT_ID')
    expect(
      loadAppConfig({ ...base, GITHUB_CLIENT_ID: 'i', GITHUB_CLIENT_SECRET: 's' }).identity
        .GITHUB_CLIENT_ID,
    ).toBe('i')
    expect(
      loadAppConfig({ ...base, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).identity
        .GOOGLE_CLIENT_ID,
    ).toBeUndefined()
  })

  test('the confirmation window defaults to five minutes', () => {
    expect(loadAppConfig(base).identity.STEP_UP_TTL).toBe(300)
    expect(loadAppConfig({ ...base, STEP_UP_TTL: '2m' }).identity.STEP_UP_TTL).toBe(120)
  })
})

describe('notification', () => {
  const vapid = {
    VAPID_PUBLIC_KEY: 'p',
    VAPID_PRIVATE_KEY: 'q',
    VAPID_SUBJECT: 'mailto:ops@example.test',
  }

  test('Web Push is off unless its three values are set together', () => {
    expect(loadAppConfig(base).notification.VAPID_PUBLIC_KEY).toBeUndefined()
    expect(() => loadAppConfig({ ...base, VAPID_PUBLIC_KEY: 'p' })).toThrow('must be set together')
    expect(loadAppConfig({ ...base, ...vapid }).notification.VAPID_SUBJECT).toBe(
      vapid.VAPID_SUBJECT,
    )
  })

  test('the push subject is a mailto: or https:// URL', () => {
    expect(() => loadAppConfig({ ...base, ...vapid, VAPID_SUBJECT: 'ops@example.test' })).toThrow(
      'VAPID_SUBJECT',
    )
  })

  test('retention is read as seconds', () => {
    expect(loadAppConfig(base).notification.NOTIFICATION_RETENTION).toBe(90 * 86400)
  })
})

describe('privacy', () => {
  test('a download link cannot outlive what S3 presigned links can', () => {
    expect(loadAppConfig({ ...base, PRIVACY_EXPORT_TTL: '7d' }).privacy.PRIVACY_EXPORT_TTL).toBe(
      7 * 86400,
    )
    expect(() => loadAppConfig({ ...base, PRIVACY_EXPORT_TTL: '8d' })).toThrow('PRIVACY_EXPORT_TTL')
  })
})

describe('billing', () => {
  const stripe = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  }

  test('Stripe is off unless its three values are set together', () => {
    expect(loadAppConfig(base).billing.STRIPE_SECRET_KEY).toBeUndefined()
    expect(() => loadAppConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(
      'must be set together',
    )
    expect(() => loadAppConfig({ ...base, ...stripe, STRIPE_WEBHOOK_SECRET: '' })).toThrow(
      'must be set together',
    )
    expect(loadAppConfig({ ...base, ...stripe }).billing.STRIPE_WEBHOOK_SECRET).toBe('whsec_x')
    expect(
      loadAppConfig({ ...base, STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '' }).billing
        .STRIPE_SECRET_KEY,
    ).toBeUndefined()
  })

  test('currencies default to all known ones and reject an unknown code', () => {
    expect(loadAppConfig(base).billing.TOPUP_CURRENCIES).toEqual(['usd', 'eur', 'vnd'])
    expect(
      loadAppConfig({ ...base, TOPUP_CURRENCIES: 'vnd, usd' }).billing.TOPUP_CURRENCIES,
    ).toEqual(['vnd', 'usd'])
    expect(() => loadAppConfig({ ...base, TOPUP_CURRENCIES: 'xyz' })).toThrow('TOPUP_CURRENCIES')
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
