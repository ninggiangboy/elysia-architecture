import { describe, expect, test } from 'bun:test'
import { loadConfig } from '@kit/config'
import { privacyConfig } from './config'

const load = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ privacy: privacyConfig }, env).privacy

describe('privacy config', () => {
  test('defaults: two weeks of grace, a week to download', () => {
    const config = load()
    expect(config.PRIVACY_DELETION_GRACE_PERIOD).toBe(14 * 86400)
    expect(config.PRIVACY_EXPORT_TTL).toBe(7 * 86400)
  })

  test('a download link cannot outlive what S3 presigned links can', () => {
    expect(load({ PRIVACY_EXPORT_TTL: '7d' }).PRIVACY_EXPORT_TTL).toBe(7 * 86400)
    expect(() => load({ PRIVACY_EXPORT_TTL: '8d' })).toThrow('PRIVACY_EXPORT_TTL')
  })
})
