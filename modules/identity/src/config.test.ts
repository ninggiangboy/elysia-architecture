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

  test('sign-in methods and registration default to everything open, as before', () => {
    const config = load()
    expect(config.SIGN_IN_METHODS).toEqual(['email', 'password', 'passkey'])
    expect(config.REGISTRATION_MODE).toBe('open')
    expect(config.REGISTRATION_EMAIL_DOMAINS).toBeUndefined()
    expect(config.TERMS_VERSION).toBeUndefined()
    expect(config.PASSWORD_MIN_LENGTH).toBe(8)
    expect(config.TOTP_ENCRYPTION_KEY).toBeUndefined()
  })

  test('methods, mode and domains are validated and normalised', () => {
    const config = load({
      SIGN_IN_METHODS: 'email, passkey',
      REGISTRATION_MODE: 'invite',
      REGISTRATION_EMAIL_DOMAINS: 'Corp.test, other.test',
      REGISTRATION_ALLOWED_EMAILS: 'Owner@Corp.test',
    })
    expect(config.SIGN_IN_METHODS).toEqual(['email', 'passkey'])
    expect(config.REGISTRATION_EMAIL_DOMAINS).toEqual(['corp.test', 'other.test'])
    expect(config.REGISTRATION_ALLOWED_EMAILS).toEqual(['owner@corp.test'])
    expect(() => load({ SIGN_IN_METHODS: 'email,sms' })).toThrow()
    expect(() => load({ REGISTRATION_MODE: 'friends' })).toThrow()
    expect(() => load({ SIGN_IN_METHODS: '' })).toThrow()
  })

  test('Microsoft and Discord need both halves like the other providers', () => {
    expect(() => load({ MICROSOFT_CLIENT_ID: 'id' })).toThrow('MICROSOFT_CLIENT_ID')
    expect(() => load({ DISCORD_CLIENT_SECRET: 's' })).toThrow('DISCORD_CLIENT_ID')
    expect(load({ MICROSOFT_CLIENT_ID: 'i', MICROSOFT_CLIENT_SECRET: 's' }).MICROSOFT_TENANT).toBe(
      'common',
    )
  })

  test('OIDC providers come as JSON and may not reuse a built-in id or each other', () => {
    const acme = {
      id: 'acme',
      name: 'Acme',
      issuer: 'https://sso.example.com',
      clientId: 'i',
      clientSecret: 's',
    }
    expect(load({ OIDC_PROVIDERS: JSON.stringify([acme]) }).OIDC_PROVIDERS).toEqual([acme])
    expect(load().OIDC_PROVIDERS).toEqual([])
    expect(() => load({ OIDC_PROVIDERS: 'not json' })).toThrow('JSON')
    expect(() => load({ OIDC_PROVIDERS: JSON.stringify([{ ...acme, id: 'google' }]) })).toThrow(
      'taken',
    )
    expect(() => load({ OIDC_PROVIDERS: JSON.stringify([acme, acme]) })).toThrow('taken')
    expect(() => load({ OIDC_PROVIDERS: JSON.stringify([{ ...acme, issuer: 'nope' }]) })).toThrow()
  })

  test('two-factor is on only with an encryption key of enough length', () => {
    expect(load({ TOTP_ENCRYPTION_KEY: 'k'.repeat(32) }).TOTP_ENCRYPTION_KEY).toBe('k'.repeat(32))
    expect(() => load({ TOTP_ENCRYPTION_KEY: 'short' })).toThrow('TOTP_ENCRYPTION_KEY')
    expect(load({ TOTP_ENCRYPTION_KEY: '' }).TOTP_ENCRYPTION_KEY).toBeUndefined()
  })

  test('the password length floor is capped by what is hashed', () => {
    expect(load({ PASSWORD_MIN_LENGTH: '12' }).PASSWORD_MIN_LENGTH).toBe(12)
    expect(() => load({ PASSWORD_MIN_LENGTH: '200' })).toThrow('PASSWORD_MIN_LENGTH')
  })
})
