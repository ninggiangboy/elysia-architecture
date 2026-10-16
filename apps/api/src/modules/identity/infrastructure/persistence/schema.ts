import { index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { outboxTable } from '#/shared/infrastructure/outbox/tables'

export const identitySchema = pgSchema('identity')

export const users = identitySchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const magicLinks = identitySchema.table(
  'magic_links',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    requestedIp: text('requested_ip').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('magic_links_email_created_idx').on(t.email, t.createdAt),
    index('magic_links_ip_created_idx').on(t.requestedIp, t.createdAt),
  ],
)

export const emailChangeRequests = identitySchema.table('email_change_requests', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  newEmail: text('new_email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
})

export const refreshTokens = identitySchema.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
)

export const outbox = outboxTable(identitySchema)
