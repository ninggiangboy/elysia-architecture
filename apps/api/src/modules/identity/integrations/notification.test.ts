import { describe, expect, test } from 'bun:test'
import type { Locale } from '@app/shared-types'
import type { Translate } from '#/modules/notification/contracts'
import { createTranslator } from '#/shared/i18n/translator'
import { en } from './messages/en'
import { vi } from './messages/vi'
import {
  describeDevice,
  identityLocaleResolver,
  identityNotifications,
  newSignInNotification,
  suspiciousSessionNotification,
} from './notification'

const translate = createTranslator(en, { vi }) as unknown as (locale: Locale) => Translate
const ALICE = 'alice'
const chromeMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

describe('new sign-in notification', () => {
  const draft = () =>
    newSignInNotification({
      userId: ALICE,
      sessionId: 's1',
      ip: '203.0.113.9',
      userAgent: chromeMac,
    })

  test('stores what the text is made from, not the text', () => {
    expect(draft()).toMatchObject({ userId: ALICE, kind: 'new_sign_in', template: 'newSignIn' })
    expect(draft().title).toBeUndefined()
    expect(draft().body).toBeUndefined()
    expect(draft().data).toMatchObject({ sessionId: 's1', ip: '203.0.113.9', userAgent: chromeMac })
  })

  test('fills the message in the reader language', () => {
    const { data = {} } = draft()
    const values = (locale: 'en' | 'vi') =>
      identityNotifications.templates.newSignIn(data, { locale, t: translate(locale) })
    expect(translate('en')('inApp.newSignIn.body', values('en'))).toContain('Chrome on macOS')
    expect(translate('en')('inApp.newSignIn.body', values('en'))).toContain('203.0.113.9')
    expect(translate('vi')('inApp.newSignIn.title')).toBe('Đăng nhập mới vào tài khoản của bạn')
  })

  test('copes with a missing user agent and ip', () => {
    expect(describeDevice(null, translate('en'))).toBe('an unknown device')
    const { data = {} } = newSignInNotification({
      userId: ALICE,
      sessionId: 's1',
      ip: null,
      userAgent: null,
    })
    const values = identityNotifications.templates.newSignIn(data, {
      locale: 'en',
      t: translate('en'),
    })
    expect(translate('en')('inApp.newSignIn.body', values)).toStartWith(
      'an unknown device signed in',
    )
  })
})

describe('in-app definitions', () => {
  const build = (name: string, payload: object) => {
    const definition = identityNotifications.inApp.find((d) => d.name === name)
    if (!definition) throw new Error(`no definition named ${name}`)
    // biome-ignore lint/suspicious/noExplicitAny: each definition takes its own payload type
    return (definition.build as (p: any) => unknown)(payload)
  }

  test('a token-reuse revocation is news; a plain logout is not', () => {
    expect(
      build('notification.in-app-suspicious-session', { userId: ALICE, reason: 'token_reuse' }),
    ).toEqual(suspiciousSessionNotification({ userId: ALICE }))
    expect(
      build('notification.in-app-suspicious-session', { userId: ALICE, reason: 'logout' }),
    ).toBeNull()
  })

  test('the first session of a new account is covered by the welcome notification', () => {
    expect(build('notification.in-app-new-sign-in', { userId: ALICE, newUser: true })).toBeNull()
  })
})

describe('identityLocaleResolver', () => {
  const identity = {
    getAccount: async (id: string) => (id === ALICE ? { locale: 'vi' } : null),
  } as unknown as Parameters<typeof identityLocaleResolver>[0]
  const resolver = identityLocaleResolver(identity)

  test('the language an event carries wins', async () => {
    expect(await resolver.resolve({ locale: 'vi', userId: 'nobody' })).toBe('vi')
  })

  test('otherwise the account decides, otherwise the default', async () => {
    expect(await resolver.resolve({ userId: ALICE })).toBe('vi')
    expect(await resolver.resolve({ userId: 'nobody' })).toBe('en')
    expect(await resolver.resolve({})).toBe('en')
  })
})
