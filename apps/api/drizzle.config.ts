import { defineConfig } from 'drizzle-kit'
import { moduleEntry } from '#/bootstrap/module-catalog'

// Each module has its own schema, migration folder and migration history table: run with MODULE=<name>
// (the names are in bootstrap/module-catalog.ts).
const name = process.env.MODULE
if (!name) throw new Error('MODULE env is required (see bootstrap/module-catalog.ts)')
const module = moduleEntry(name)

export default defineConfig({
  dialect: 'postgresql',
  schema: module.schemaFile,
  out: module.migrations,
  schemaFilter: [module.name],
  migrations: { schema: `drizzle_${module.name}`, table: '__migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
})
