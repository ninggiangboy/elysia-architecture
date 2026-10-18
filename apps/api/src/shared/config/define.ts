import type { z } from 'zod'

/**
 * One part of the configuration: the variables a package or module reads, parsed from the same environment as every other
 * part. A slice lists its variables with `.describe(...)` (the `.env.example` is generated from them) and converts nothing
 * beyond the unit of a value (`30d` → seconds); the owner turns it into what it needs.
 */
export interface ConfigSlice<S extends z.ZodType = z.ZodType> {
  /** Heading of the section in `.env.example`. */
  title: string
  /** Text under the heading: what the section is for, and what to do first. */
  notes?: string
  schema: S
  /**
   * Values the sample file ships uncommented: variables with no default (`DATABASE_URL`) and ones that are on in the
   * sample app. The rest of the file lists each variable commented out with its default.
   */
  example?: Readonly<Record<string, string>>
}

export const defineSlice = <S extends z.ZodType>(slice: ConfigSlice<S>) => slice
