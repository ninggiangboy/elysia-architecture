import { bool, defineSlice, posInt } from '@kit/config'
import { z } from 'zod'

export const dbConfig = defineSlice({
  title: 'Postgres (one shared pool; modules are separated by schema)',
  example: { DATABASE_URL: 'postgres://app:app@localhost:5433/app', DB_POOL_MAX: '10' },
  schema: z.object({
    DATABASE_URL: z.string().min(1).describe('Connection string.'),
    DB_POOL_MAX: posInt(10).describe(
      'Pool size. Per process: Postgres sees APP_PROCESSES × DB_POOL_MAX connections per instance.',
    ),
    DB_PREPARE: bool('true').describe(
      'Use prepared statements. Turn off behind a transaction-mode pooler (PgBouncer).',
    ),
  }),
})
