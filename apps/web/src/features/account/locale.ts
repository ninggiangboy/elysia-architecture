import type { Locale } from '@app/shared-types'
import { setLocale } from '@/i18n'
import { http, unwrap } from '@/lib/api'
import { authStore } from '@/lib/auth-store'

/**
 * The person picked a language. The app switches at once; when signed in the account is told too, because the
 * emails and notifications we send follow the account, not this browser. A failed save does not undo the switch:
 * the next sign-in adopts whatever the account still says, and the picker can be used again.
 */
export async function chooseLocale(locale: Locale) {
  await setLocale(locale)
  if (!authStore.get().accessToken) return
  try {
    unwrap(await http.api.account.locale.put({ locale }))
  } catch {
    // Not worth interrupting the person for: the interface is already in their language.
  }
}
