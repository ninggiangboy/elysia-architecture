import { describe, expect, test } from 'bun:test'
import { LOCALES } from '@app/shared-types/locales'
import { diffCatalogs } from '@kit/i18n'
import { identityNotifications } from '@mod/identity/integrations/notification'
import { createMessages } from '@mod/notification/testing'
import { privacyNotifications } from '@mod/privacy/integrations/notification'
import { billingNotifications } from '#/modules/billing/integrations/notification'

// The notification module checks its own pieces; this checks the catalogs the reference app actually installs.
describe('notification messages of the reference app', () => {
  const messages = createMessages({
    integrations: [identityNotifications, privacyNotifications, billingNotifications],
  })

  test('every translation has the same keys and placeholders as the English source', () => {
    for (const locale of LOCALES.filter((l) => l !== 'en'))
      expect(diffCatalogs(messages.catalogs.en, messages.catalogs[locale])).toEqual([])
  })

  test('fills placeholders and picks the plural form', () => {
    const t = messages.translate('en')
    expect(t('common.minutes', { count: 1 })).toBe('1 minute')
    expect(t('common.minutes', { count: 5 })).toBe('5 minutes')
    expect(messages.translate('vi')('common.minutes', { count: 1 })).toBe('1 phút')
    expect(t('mail.welcome.body', { email: 'a@b.co' })).toBe('Your account a@b.co is ready.')
  })
})
