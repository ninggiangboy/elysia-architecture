import { defineConfig } from 'drizzle-kit'

// Each module has its own schema, migration folder and migration history table. Run through `bun run db:generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['realtime'],
  migrations: { schema: 'drizzle_realtime', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL || '' },
})
