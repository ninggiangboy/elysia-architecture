import { z } from 'zod'
import { parseDurationSeconds } from './duration'

export const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** A duration written `15m` / `30d`, read as seconds. */
export const duration = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v, ctx) => {
      try {
        return parseDurationSeconds(v)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message })
        return z.NEVER
      }
    })

/** An empty variable (e.g. `${VAR:-}` in compose) counts as unset. */
export const blank = z
  .string()
  .optional()
  .transform((v) => v || undefined)

/** A PEM key kept on one line in an env file (`\n` escapes). */
export const pem = z
  .string()
  .min(1)
  .transform((v) => v.replace(/\\n/g, '\n'))

/** `true` / `false`. */
export const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true')

export const posInt = (def: number) => z.coerce.number().int().positive().default(def)

/** Comma-separated names, each one of `values`. */
export const list = <const T extends readonly string[]>(values: T, def: string) =>
  z
    .string()
    .default(def)
    .transform(csv)
    .pipe(z.array(z.enum(values)).min(1))

/**
 * A group of variables that switch a feature on together: all set or none (an empty value counts as unset).
 * Use inside a slice's `superRefine`, once per group.
 */
export function allOrNone(
  ctx: z.RefinementCtx,
  values: Record<string, string | undefined>,
  label = Object.keys(values).join(', '),
) {
  const set = Object.values(values).filter(Boolean).length
  if (set === 0 || set === Object.keys(values).length) return
  ctx.addIssue({
    code: 'custom',
    path: [Object.keys(values)[0] as string],
    message: `${label} must be set together`,
  })
}
