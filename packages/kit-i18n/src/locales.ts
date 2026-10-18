/**
 * Declares the languages a product speaks and the small functions around them. The product calls it once and re-exports
 * the result, so the list lives in one place and every function is typed by it:
 *
 *   export const { LOCALES, DEFAULT_LOCALE, isLocale, negotiateLocale } = defineLocales(['en', 'vi'], { … })
 */
export function defineLocales<
  const Locales extends readonly [string, ...string[]],
  const Default extends Locales[number],
>(locales: Locales, options: { default: Default; names: Record<Locales[number], string> }) {
  type Locale = Locales[number]

  const isLocale = (value: unknown): value is Locale =>
    typeof value === 'string' && (locales as readonly string[]).includes(value)

  /** "vi-VN" → "vi", "en_GB" → "en"; `null` when we do not speak it. */
  const matchLocale = (tag: string): Locale | null => {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0]
    return isLocale(primary) ? primary : null
  }

  /** Picks the best supported language from an `Accept-Language` header (highest `q` first); `null` when none is supported. */
  const negotiateLocale = (acceptLanguage: string | null | undefined): Locale | null => {
    if (!acceptLanguage) return null
    const ranked = acceptLanguage
      .split(',')
      .map((part, index) => {
        const [tag = '', ...params] = part.split(';')
        const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
        const weight = q ? Number.parseFloat(q.slice(2)) : 1
        return { tag, weight: Number.isNaN(weight) ? 0 : weight, index }
      })
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.index - b.index)
    for (const { tag } of ranked) {
      const locale = matchLocale(tag)
      if (locale) return locale
    }
    return null
  }

  return {
    LOCALES: locales,
    DEFAULT_LOCALE: options.default,
    /** Names in their own language, for a language picker (never translated: a reader must find their own language). */
    LOCALE_NAMES: options.names,
    isLocale,
    matchLocale,
    negotiateLocale,
  }
}
