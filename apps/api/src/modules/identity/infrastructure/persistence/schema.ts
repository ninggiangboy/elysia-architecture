import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { inboxTable, outboxTable } from '#/shared/infrastructure/outbox/tables'

export const identitySchema = pgSchema('identity')

export const users = identitySchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  /** Language the account is addressed in (a `Locale` of `@app/shared-types`). */
  locale: text('locale').notNull().default('en'),
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

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
})

export const passkeys = identitySchema.table(
  'passkeys',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    version: integer('version').notNull(),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull(),
    transports: text('transports').array().notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
)

export const webauthnChallenges = identitySchema.table(
  'webauthn_challenges',
  {
    id: uuid('id').primaryKey(),
    challenge: text('challenge').notNull(),
    purpose: text('purpose').notNull(),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('webauthn_challenges_expires_idx').on(t.expiresAt)],
)

export const oauthAccounts = identitySchema.table(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('oauth_accounts_provider_user_unique').on(t.provider, t.providerUserId),
    unique('oauth_accounts_user_provider_unique').on(t.userId, t.provider),
  ],
)

export const oauthStates = identitySchema.table(
  'oauth_states',
  {
    id: uuid('id').primaryKey(),
    stateHash: text('state_hash').notNull().unique(),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    purpose: text('purpose').notNull(),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('oauth_states_expires_idx').on(t.expiresAt)],
)

export const stepUpCodes = identitySchema.table(
  'step_up_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('step_up_codes_user_created_idx').on(t.userId, t.createdAt)],
)

export const outbox = outboxTable(identitySchema)
export const inbox = inboxTable(identitySchema)
