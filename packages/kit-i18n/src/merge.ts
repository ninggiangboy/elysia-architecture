import type { Catalog } from './catalog'

const isCatalog = (value: string | Catalog | undefined): value is Catalog =>
  typeof value === 'object' && value !== null

type Tree = Record<string, string | Catalog>

const join = (path: string, key: string) => (path ? `${path}.${key}` : key)

/** The group already at `target[key]` to merge into, a fresh one when there is none; a message there is a clash. */
function groupAt(target: Tree, key: string, path: string): Tree {
  const existing = target[key]
  if (existing === undefined) return {}
  if (!isCatalog(existing)) throw new Error(`Duplicate message key: ${path}`)
  return existing as Tree
}

function mergeInto(target: Tree, source: Catalog, path: string) {
  for (const [key, value] of Object.entries(source)) {
    const here = join(path, key)
    if (isCatalog(value)) {
      const group = groupAt(target, key, here)
      target[key] = group
      mergeInto(group, value, here)
    } else {
      if (target[key] !== undefined) throw new Error(`Duplicate message key: ${here}`)
      target[key] = value
    }
  }
}

/**
 * Deep-merges catalogs that each own a part of the tree (a module's own sentences, plus those every producer ships).
 * Two catalogs defining the same key is a bug, not an override: it throws and names the key.
 */
export function mergeCatalogs(...catalogs: readonly (Catalog | undefined)[]): Catalog {
  const out: Tree = {}
  for (const catalog of catalogs) if (catalog) mergeInto(out, catalog, '')
  return out
}

function overrideAt(target: Catalog, source: Catalog, path: string): Catalog {
  const out: Tree = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const here = join(path, key)
    const existing = target[key]
    if (existing === undefined) throw new Error(`Cannot override unknown message key: ${here}`)
    if (isCatalog(value) !== isCatalog(existing))
      throw new Error(`Cannot override ${here}: a message cannot become a group or the reverse`)
    out[key] = isCatalog(value) ? overrideAt(existing as Catalog, value, here) : value
  }
  return out
}

/**
 * Replaces messages that already exist (the one layer allowed to). A key the base does not have is rejected, so a typo in
 * an override fails at startup instead of silently doing nothing.
 */
export function overrideCatalog(base: Catalog, overrides: Catalog | undefined): Catalog {
  return overrides ? overrideAt(base, overrides, '') : base
}

/** Every dotted path that has a message, plural forms folded (`a.b_one` + `a.b_other` → `a.b`). */
export function messagePaths(catalog: Catalog, prefix = ''): Set<string> {
  const out = new Set<string>()
  for (const [key, value] of Object.entries(catalog)) {
    if (isCatalog(value)) for (const p of messagePaths(value, `${prefix}${key}.`)) out.add(p)
    else out.add(`${prefix}${key.replace(/_(zero|one|two|few|many|other)$/, '')}`)
  }
  return out
}
