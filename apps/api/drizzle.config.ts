import { defineConfig } from 'drizzle-kit'

// Each module has its own schema, migration folder and migration history table: run with MODULE=<identity|profile|notification|privacy|realtime>.
const module = process.env.MODULE
if (!module)
  throw new Error('MODULE env is required (identity | profile | notification | privacy | realtime)')

export default defineConfig({
  dialect: 'postgresql',
  schema: `./src/modules/${module}/infrastructure/persistence/schema.ts`,
  out: `./src/modules/${module}/migrations`,
  schemaFilter: [module],
  migrations: { schema: `drizzle_${module}`, table: '__migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
})
