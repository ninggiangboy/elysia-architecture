const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** "15m" → 900, "30d" → 2592000. */
export function parseDurationSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim())
  if (!match) throw new Error(`Invalid duration "${input}" (expected e.g. 15m, 30d)`)
  return Number(match[1]) * UNITS[match[2] as string]!
}
