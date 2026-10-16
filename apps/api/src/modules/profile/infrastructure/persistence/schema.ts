import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { inboxTable, outboxTable } from '#/shared/infrastructure/outbox/tables'

export const profileSchema = pgSchema('profile')

/** `user_id` references the identity module's user by value — NO cross-module FK. */
export const profiles = profileSchema.table('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  bio: text('bio'),
  avatarKey: text('avatar_key'),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const outbox = outboxTable(profileSchema)
export const inbox = inboxTable(profileSchema)
