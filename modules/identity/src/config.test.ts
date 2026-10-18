import { describe, expect, test } from 'bun:test'
import { loadConfig } from '@kit/config'
import { identityConfig } from './config'

const base = {
  JWT_PRIVATE_KEY: 'k',
  JWT_PUBLIC_KEY: 'k',
  STEP_UP_CODE_SECRET: 'x'.repeat(32),
}
const load = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ identity: identityConfig }, { ...base, ...env }).identity

describe('identity config', () => {
  test('WebAuthn settings are left unset so the module can follow WEB_APP_URL', () => {
    const config = load({ WEB_APP_URL: 'https://app.example.com:8443/x' })
    expect(config.WEBAUTHN_RP_ID).toBeUndefined()
    expect(config.WEBAUTHN_ORIGINS).toBeUndefined()
    expect(config.WEB_APP_URL).toBe('https://app.example.com:8443/x')
  })

  test('WebAuthn can be pointed elsewhere', () => {
    const config = load({
      WEBAUTHN_RP_ID: 'example.com',
      WEBAUTHN_ORIGINS: 'https://a.example.com, https://b.example.com',
    })
    expect(config.WEBAUTHN_RP_ID).toBe('example.com')
    expect(config.WEBAUTHN_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  test('an OAuth provider needs both its id and its secret', () => {
    expect(() => load({ GOOGLE_CLIENT_ID: 'id' })).toThrow('GOOGLE_CLIENT_ID')
    expect(() => load({ GITHUB_CLIENT_SECRET: 's' })).toThrow('GITHUB_CLIENT_ID')
    expect(load({ GITHUB_CLIENT_ID: 'i', GITHUB_CLIENT_SECRET: 's' }).GITHUB_CLIENT_ID).toBe('i')
    expect(
      load({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).GOOGLE_CLIENT_ID,
    ).toBeUndefined()
  })

  test('the confirmation window defaults to five minutes', () => {
    expect(load().STEP_UP_TTL).toBe(300)
    expect(load({ STEP_UP_TTL: '2m' }).STEP_UP_TTL).toBe(120)
  })

  test('the signing keys and the step-up secret are required', () => {
    expect(() => loadConfig({ identity: identityConfig }, {})).toThrow('JWT_PRIVATE_KEY')
    expect(() => load({ STEP_UP_CODE_SECRET: 'short' })).toThrow('STEP_UP_CODE_SECRET')
  })
})
