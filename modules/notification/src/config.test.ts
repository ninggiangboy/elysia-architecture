import { describe, expect, test } from 'bun:test'
import { loadConfig } from '@kit/config'
import { notificationConfig } from './config'

const load = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ notification: notificationConfig }, env).notification
const vapid = {
  VAPID_PUBLIC_KEY: 'p',
  VAPID_PRIVATE_KEY: 'q',
  VAPID_SUBJECT: 'mailto:ops@example.test',
}

describe('notification config', () => {
  test('Web Push is off unless its three values are set together', () => {
    expect(load().VAPID_PUBLIC_KEY).toBeUndefined()
    expect(() => load({ VAPID_PUBLIC_KEY: 'p' })).toThrow('must be set together')
    expect(load(vapid).VAPID_SUBJECT).toBe(vapid.VAPID_SUBJECT)
  })

  test('the push subject is a mailto: or https:// URL', () => {
    expect(() => load({ ...vapid, VAPID_SUBJECT: 'ops@example.test' })).toThrow('VAPID_SUBJECT')
  })

  test('retention is read as seconds', () => {
    expect(load().NOTIFICATION_RETENTION).toBe(90 * 86400)
    expect(load({ NOTIFICATION_RETENTION: '7d' }).NOTIFICATION_RETENTION).toBe(7 * 86400)
  })
})
