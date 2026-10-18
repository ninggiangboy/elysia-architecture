/** A message catalog: nested objects whose leaves are strings. Plural forms are sibling keys with an `_one` / `_other`… suffix (the i18next convention). */
export interface Catalog {
  readonly [key: string]: string | Catalog
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** `{ a: { b_one: 'x', b_other: 'y' } }` → `Map { 'a.b' → ['x', 'y'] }`: plural forms folded into one key. */
function flatten(catalog: Catalog, prefix = '', out = new Map<string, string[]>()) {
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === 'string') {
      const path = `${prefix}${key.replace(PLURAL_SUFFIX, '')}`
      out.set(path, [...(out.get(path) ?? []), value])
    } else flatten(value, `${prefix}${key}.`, out)
  }
  return out
}

const placeholders = (strings: string[]) =>
  [...new Set(strings.flatMap((s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])))]
    .filter((name) => name !== 'count')
    .sort()
    .join(',')

/**
 * What a translation lacks or gets wrong compared to the base catalog: missing keys, keys the base does not have, and
 * `{{placeholders}}` that differ (a translator dropping `{{email}}` is a bug, not a style choice). Empty = in step.
 */
export function diffCatalogs(base: Catalog, other: Catalog): string[] {
  const a = flatten(base)
  const b = flatten(other)
  const problems: string[] = []
  for (const [key, values] of a) {
    const translated = b.get(key)
    if (!translated) problems.push(`missing: ${key}`)
    else if (placeholders(values) !== placeholders(translated))
      problems.push(`placeholders differ: ${key}`)
  }
  for (const key of b.keys()) if (!a.has(key)) problems.push(`unknown: ${key}`)
  return problems
}
