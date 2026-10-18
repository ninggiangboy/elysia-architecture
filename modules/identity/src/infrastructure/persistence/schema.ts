import { inboxTable, outboxTable } from '@kit/messaging'
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

export const identitySchema = pgSchema('identity')

export const users = identitySchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  /** Language the account is addressed in (a `Locale` of `@app/shared-types`). */
  locale: text('locale').notNull().default('en'),
  /** argon2id (PHC string); null = the account has no password. */
  passwordHash: text('password_hash'),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  /** The `TERMS_VERSION` accepted when the account was created; null when none was required. */
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
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
    /** Keyed hash of the 6-digit code mailed with the link; null on links issued before codes existed. */
    codeHash: text('code_hash'),
    /** Wrong codes tried against this link; it stops accepting codes at the limit. */
    attempts: integer('attempts').notNull().default(0),
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

/**
 * An account being created. Either the email is already proven (a magic link, a code or a provider vouched for it) and
 * the person is choosing a name and accepting the terms, or they signed up with a password and the email still has to
 * be verified. No `users` row exists until both are done, so every account has a proven address.
 */
export const signups = identitySchema.table(
  'signups',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    /** Hash of the signup token (returned to the client) or of the verification token (mailed). */
    tokenHash: text('token_hash').notNull().unique(),
    /** Keyed hash of the verification code mailed with the link (password sign-up only). */
    codeHash: text('code_hash'),
    attempts: integer('attempts').notNull().default(0),
    emailProvenAt: timestamp('email_proven_at', { withTimezone: true }),
    /** How the email was proven / will be: `magic_link`, `email_code`, `oauth:<provider>`, `password`. */
    method: text('method').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name'),
    termsVersion: text('terms_version'),
    locale: text('locale').notNull(),
    oauthProvider: text('oauth_provider'),
    oauthProviderUserId: text('oauth_provider_user_id'),
    oauthEmail: text('oauth_email'),
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('signups_email_created_idx').on(t.email, t.createdAt),
    index('signups_ip_created_idx').on(t.requestedIp, t.createdAt),
    index('signups_expires_idx').on(t.expiresAt),
  ],
)

export const passwordResets = identitySchema.table(
  'password_resets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    requestedIp: text('requested_ip').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('password_resets_email_created_idx').on(t.email, t.createdAt),
    index('password_resets_ip_created_idx').on(t.requestedIp, t.createdAt),
  ],
)

/** Wrong passwords and wrong sign-in codes, counted per address and per IP to slow down guessing. */
export const signInFailures = identitySchema.table(
  'sign_in_failures',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    ip: text('ip').notNull(),
    method: text('method').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sign_in_failures_email_created_idx').on(t.email, t.createdAt),
    index('sign_in_failures_ip_created_idx').on(t.ip, t.createdAt),
  ],
)

/** One authenticator app per user. Pending until the first code is confirmed. */
export const totpCredentials = identitySchema.table('totp_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  /** AES-256-GCM under TOTP_ENCRYPTION_KEY: the server needs the secret back to check codes. */
  secretCiphertext: text('secret_ciphertext').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /** The time step of the last accepted code: a code never works twice. */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const recoveryCodes = identitySchema.table(
  'recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [unique('recovery_codes_user_code_unique').on(t.userId, t.codeHash)],
)

/** First factor done, second factor pending: the token the client holds while the user types the authenticator code. */
export const mfaChallenges = identitySchema.table(
  'mfa_challenges',
  {
    id: uuid('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The first factor (`password`, `magic_link`, `oauth:google`…), for `session_started`. */
    method: text('method').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('mfa_challenges_expires_idx').on(t.expiresAt)],
)

/** In `invite` registration mode, an address a member allowed to create an account. */
export const invitations = identitySchema.table(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('invitations_email_idx').on(t.email),
    index('invitations_inviter_created_idx').on(t.invitedBy, t.createdAt),
  ],
)

export const outbox = outboxTable(identitySchema)
export const inbox = inboxTable(identitySchema)
