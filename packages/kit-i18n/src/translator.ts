import type { Catalog } from './catalog'

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
  defaultLocale: string,
  base: Base,
  translations: Readonly<Record<string, Catalog>>,
) {
  const catalogs: Record<string, Catalog> = { [defaultLocale]: base, ...translations }
  /** The first form the language (then the default one) has a message for. */
  const find = (languages: readonly string[], forms: readonly string[]) => {
    for (const lang of languages) {
      const catalog = catalogs[lang]
      const found =
        catalog && forms.map((form) => lookup(catalog, form)).find((m) => m !== undefined)
      if (found !== undefined) return found
    }
    return undefined
  }
  return (locale: string): Translate<MessageKey<Base>> => {
    const rules = new Intl.PluralRules(locale)
    return (key, params) => {
      const count = typeof params?.count === 'number' ? params.count : undefined
      const forms =
        count === undefined ? [key] : [`${key}_${rules.select(count)}`, `${key}_other`, key]
      const template = find([locale, defaultLocale], forms) ?? key
      return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
        params && name in params ? String(params[name]) : whole,
      )
    }
  }
}
