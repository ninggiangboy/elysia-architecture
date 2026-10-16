/** Languages the product speaks, shared by web ↔ api (no logic beyond picking one). Add a language here, then a catalog on each side. */
export const LOCALES = ['en', 'vi'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE = 'en' satisfies Locale

/** Names in their own language, for a language picker (never translated: a reader must find their own language). */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', vi: 'Tiếng Việt' }

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

/** "vi-VN" → "vi", "en_GB" → "en"; `null` when we do not speak it. */
export function matchLocale(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0]
  return isLocale(primary) ? primary : null
}

/** Picks the best supported language from an `Accept-Language` header (highest `q` first); `null` when none is supported. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
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
