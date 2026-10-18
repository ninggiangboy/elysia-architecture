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

/** The line a variable gets: its example value when it has one, else its default commented out, else a blank to fill in. */
function valueLine(name: string, field: z.ZodType, example: string | null | undefined): string {
  if (example !== undefined && example !== null) return `${name}=${example}`
  const fallback = defaultOf(field)
  if (fallback !== undefined) return `# ${name}=${fallback}`
  return isOptional(field) ? `# ${name}=` : `${name}=`
}

function renderSlice(
  slice: ConfigSlice,
  listed: Set<string>,
  set: Record<string, string | null>,
): string {
  const shape = (slice.schema as unknown as { shape: Record<string, z.ZodType> }).shape
  const lines = [`# ---- ${slice.title} ----`]
  if (slice.notes) lines.push(comment(slice.notes))
  for (const [name, field] of Object.entries(shape)) {
    // A variable two slices read (WEB_APP_URL) is listed once, where it first appears.
    if (listed.has(name)) continue
    listed.add(name)
    if (field.description) lines.push(comment(field.description))
    // `set` wins over the slice's own example; `null` there means "leave it commented out".
    lines.push(valueLine(name, field, name in set ? set[name] : slice.example?.[name]))
  }
  return lines.join('\n')
}

/**
 * The `.env.example` file, written from the slices: each variable with its description and default, grouped by owner.
 * Generated (`bun run --filter @app/api config:example`) and checked by a test, so it cannot drift from the schemas.
 */
export function renderEnvExample(
  slices: Record<string, ConfigSlice>,
  options: {
    /** Values this app ships uncommented, over each slice's own examples (a starter that runs on the local disk). */
    set?: Record<string, string | null>
    /** The command that regenerates the file, named in its header. */
    command?: string
  } = {},
): string {
  const { set = {}, command = 'bun run config:example' } = options
  const header = `# Generated from the config slices: run \`${command}\` after changing one. Do not edit by hand.\n`
  const listed = new Set<string>()
  return `${header}\n${Object.values(slices)
    .map((slice) => renderSlice(slice, listed, set))
    .join('\n\n')}\n`
}

export interface VariableDoc {
  name: string
  description: string
  /** The value used when unset; `undefined` when there is none. */
  default: string | undefined
  required: boolean
}

/** The variables of a slice, for documentation (a README table). */
export function describeSlice(slice: ConfigSlice): VariableDoc[] {
  const shape = (slice.schema as unknown as { shape: Record<string, z.ZodType> }).shape
  return Object.entries(shape).map(([name, field]) => ({
    name,
    description: field.description ?? '',
    default: defaultOf(field),
    required: defaultOf(field) === undefined && !isOptional(field),
  }))
}
