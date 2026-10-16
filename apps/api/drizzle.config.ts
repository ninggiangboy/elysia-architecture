import { defineConfig } from 'drizzle-kit'

// Mỗi module có schema, thư mục migration và bảng lịch sử migration riêng: chạy với MODULE=<identity|profile|notification>.
const module = process.env.MODULE
if (!module) throw new Error('MODULE env is required (identity | profile | notification)')

export default defineConfig({
  dialect: 'postgresql',
  schema: `./src/modules/${module}/infrastructure/persistence/schema.ts`,
  out: `./src/modules/${module}/migrations`,
  schemaFilter: [module],
  migrations: { schema: `drizzle_${module}`, table: '__migrations' },
  dbCredentials: {
    url: process.env[`${module.toUpperCase()}_DATABASE_URL`] || process.env.DATABASE_URL || '',
  },
})
