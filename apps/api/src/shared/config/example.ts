import type { z } from 'zod'
import type { ConfigSlice } from './define'

interface Introspected {
  _zod: {
    def: { type: string; defaultValue?: unknown; in?: z.ZodType; innerType?: z.ZodType }
    optin?: string
  }
}

/** The default a variable has when unset, as written in an env file; `undefined` = no default. */
function defaultOf(schema: z.ZodType): string | undefined {
  const { def } = (schema as unknown as Introspected)._zod
  if (def.type === 'default') {
    const value = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue
    return String(value)
  }
  if (def.type === 'pipe' && def.in) return defaultOf(def.in)
  return undefined
}

const isOptional = (schema: z.ZodType) =>
  (schema as unknown as Introspected)._zod.optin === 'optional'

const comment = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `# ${line}` : '#'))
    .join('\n')

function renderSlice(slice: ConfigSlice, listed: Set<string>): string {
  const shape = (slice.schema as unknown as { shape: Record<string, z.ZodType> }).shape
  const lines = [`# ---- ${slice.title} ----`]
  if (slice.notes) lines.push(comment(slice.notes))
  for (const [name, field] of Object.entries(shape)) {
    // A variable two slices read (WEB_APP_URL) is listed once, where it first appears.
    if (listed.has(name)) continue
    listed.add(name)
    if (field.description) lines.push(comment(field.description))
    const example = slice.example?.[name]
    const fallback = defaultOf(field)
    if (example !== undefined) lines.push(`${name}=${example}`)
    else if (fallback !== undefined) lines.push(`# ${name}=${fallback}`)
    else if (isOptional(field)) lines.push(`# ${name}=`)
    else lines.push(`${name}=`)
  }
  return lines.join('\n')
}

/**
 * The `.env.example` file, written from the slices: each variable with its description and default, grouped by owner.
 * Generated (`bun run --filter @app/api config:example`) and checked by a test, so it cannot drift from the schemas.
 */
export function renderEnvExample(slices: Record<string, ConfigSlice>): string {
  const header =
    '# Generated from the config slices: run `bun run --filter @app/api config:example` after changing one. Do not edit by hand.\n'
  const listed = new Set<string>()
  return `${header}\n${Object.values(slices)
    .map((slice) => renderSlice(slice, listed))
    .join('\n\n')}\n`
}
