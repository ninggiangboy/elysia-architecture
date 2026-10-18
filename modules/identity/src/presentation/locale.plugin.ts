import { DEFAULT_LOCALE, type Locale, negotiateLocale } from '@app/shared-types/locales'
import { Elysia } from 'elysia'

/** The language of the request, from `Accept-Language` (the web app sends the one the user picked); the default when it names none we speak. */
const requestLocale = (request: Request): Locale =>
  negotiateLocale(request.headers.get('accept-language')) ?? DEFAULT_LOCALE

/** Adds `locale` to the handler context. */
export const localePlugin = new Elysia({ name: 'locale' }).derive(
  { as: 'scoped' },
  ({ request }) => ({
    locale: requestLocale(request),
  }),
)
