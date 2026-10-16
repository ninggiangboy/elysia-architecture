import { type Catalog, DEFAULT_LOCALE, type Locale } from '@app/shared-types'

type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** Every key a catalog defines, as a dotted path (plural forms folded into one key). Catalog keys must not contain `_`. */
export type MessageKey<C, P extends string = ''> = {
  [K in keyof C & string]: C[K] extends string
    ? `${P}${K extends `${infer Base}_${PluralSuffix}` ? Base : K}`
    : MessageKey<C[K], `${P}${K}.`>
}[keyof C & string]

type Params = Record<string, string | number>

export type Translate<K extends string = string> = (key: K, params?: Params) => string

const lookup = (catalog: Catalog, path: string): string | undefined => {
  let node: string | Catalog | undefined = catalog
  for (const part of path.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * A tiny message translator with the same catalog format as the web's i18next (`{{name}}` placeholders, `_one`/`_other`
 * plural keys chosen by `count`), so a message reads the same on both sides. Falls back to the default language, then to the key.
 */
export function createTranslator<Base extends Catalog>(
  base: Base,
  translations: Record<Exclude<Locale, typeof DEFAULT_LOCALE>, Catalog>,
) {
  const catalogs: Record<Locale, Catalog> = { [DEFAULT_LOCALE]: base, ...translations }
  return (locale: Locale): Translate<MessageKey<Base>> => {
    const rules = new Intl.PluralRules(locale)
    return (key, params) => {
      const count = typeof params?.count === 'number' ? params.count : undefined
      const forms =
        count === undefined ? [key] : [`${key}_${rules.select(count)}`, `${key}_other`, key]
      let template: string | undefined
      for (const lang of [locale, DEFAULT_LOCALE] as Locale[]) {
        template = forms.map((form) => lookup(catalogs[lang], form)).find((m) => m !== undefined)
        if (template !== undefined) break
      }
      return (template ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
        params && name in params ? String(params[name]) : whole,
      )
    }
  }
}
