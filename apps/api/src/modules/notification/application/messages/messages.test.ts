import { describe, expect, test } from 'bun:test'
import { diffCatalogs, LOCALES } from '@app/shared-types'
import type { NotificationIntegration } from '../../contracts'
import { en } from './en'
import { createMessages } from './index'
import { vi } from './vi'

const integration = {
  templates: { greeted: () => ({}) },
  mails: [
    {
      name: 'test.send-greeting',
      eventType: 'test.greeted.v1',
      template: 'greeting',
      build: () => ({ to: 'a@b.co' }),
    },
  ],
  messages: {
    en: {
      mail: { greeting: { subject: 'Hi', title: 'Hi', body: 'Hello {{name}}' } },
      inApp: { greeted: { title: 'Greeted', body: 'You were greeted' } },
    },
    vi: {
      mail: { greeting: { subject: 'Chào', title: 'Chào', body: 'Xin chào {{name}}' } },
      inApp: { greeted: { title: 'Được chào', body: 'Bạn được chào' } },
    },
  },
} satisfies NotificationIntegration

describe('notification base messages', () => {
  test('every translation has the same keys and placeholders as the English source', () => {
    expect(diffCatalogs(en, vi)).toEqual([])
  })
})

describe('createMessages', () => {
  test('merges the integration catalogs under the module own', () => {
    const t = createMessages({ integrations: [integration] }).translate('en')
    expect(t('mail.greeting.body', { name: 'Ann' })).toBe('Hello Ann')
    expect(t('common.minutes', { count: 5 })).toBe('5 minutes')
    expect(
      createMessages({ integrations: [integration] }).translate('vi')('common.minutes', {
        count: 1,
      }),
    ).toBe('1 phút')
  })

  test('every supported language has a catalog', () => {
    const messages = createMessages({ integrations: [integration] })
    for (const locale of LOCALES)
      expect(messages.translate(locale)('mail.greeting.subject')).not.toBe('mail.greeting.subject')
  })

  test('overrides reword a message without touching the rest', () => {
    const t = createMessages({
      integrations: [integration],
      overrides: { en: { mail: { greeting: { subject: 'Howdy' } } } },
    }).translate('en')
    expect(t('mail.greeting.subject')).toBe('Howdy')
    expect(t('mail.greeting.title')).toBe('Hi')
  })

  test('an override for a message that does not exist fails at startup', () => {
    expect(() =>
      createMessages({
        integrations: [integration],
        overrides: { en: { mail: { greeting: { subjct: 'typo' } } } },
      }),
    ).toThrow('Cannot override unknown message key: mail.greeting.subjct')
  })

  test('two integrations defining the same message is an error', () => {
    expect(() => createMessages({ integrations: [integration, integration] })).toThrow(
      'Duplicate message key',
    )
  })

  test('a template with no message in some language fails at startup, naming it', () => {
    const missingVi = {
      ...integration,
      messages: { ...integration.messages, vi: { inApp: integration.messages.vi.inApp } },
    }
    expect(() => createMessages({ integrations: [missingVi] })).toThrow(
      'missing in "vi": mail.greeting.subject, mail.greeting.title, mail.greeting.body',
    )
  })
})
