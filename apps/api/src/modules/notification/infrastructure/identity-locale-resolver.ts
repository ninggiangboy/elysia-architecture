import { isLocale, type Locale } from '@app/shared-types'
import type { IdentityApi } from '#/modules/identity/contracts'
import { payloadLocale } from '../application/payload-locale'
import type { LocaleResolver, Recipient } from '../application/ports'

/**
 * A language the event carries wins (a magic link is written in the language of the page that asked for it); otherwise
 * the recipient's account decides. A lookup error propagates, so the relay retries instead of writing in the wrong language.
 */
export class IdentityLocaleResolver implements LocaleResolver {
  constructor(private identity: IdentityApi) {}

  async resolve(recipient: Recipient): Promise<Locale> {
    if (isLocale(recipient.locale) || !recipient.userId) return payloadLocale.resolve(recipient)
    const account = await this.identity.getAccount(recipient.userId)
    return payloadLocale.resolve({ locale: account?.locale })
  }
}
