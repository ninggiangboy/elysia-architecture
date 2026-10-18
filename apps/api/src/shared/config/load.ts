import type { z } from 'zod'
import type { ConfigSlice } from './define'

export type Env = Record<string, string | undefined>

export type LoadedConfig<Slices extends Record<string, ConfigSlice>> = {
  [K in keyof Slices]: z.infer<Slices[K]['schema']>
}

/**
 * Parses every slice against the same environment and fails once, listing every problem of every slice.
 * `{ core: { PORT }, billing: { STRIPE_SECRET_KEY } }`: a package reads only its own slice.
 */
export function loadConfig<const Slices extends Record<string, ConfigSlice>>(
  slices: Slices,
  env: Env = process.env,
): LoadedConfig<Slices> {
  const problems: string[] = []
  const loaded: Record<string, unknown> = {}
  for (const [name, slice] of Object.entries(slices)) {
    const parsed = slice.schema.safeParse(env)
    if (parsed.success) loaded[name] = parsed.data
    else for (const i of parsed.error.issues) problems.push(`  - ${i.path.join('.')}: ${i.message}`)
  }
  if (problems.length > 0) throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
  return loaded as LoadedConfig<Slices>
}
