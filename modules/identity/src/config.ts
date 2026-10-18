import { allOrNone, blank, csv, defineSlice, duration, list, pem, posInt } from '@kit/config'
import { z } from 'zod'

/** Ways to sign in the deployment offers (OAuth providers are switched on by their credentials instead). */
export const SIGN_IN_METHODS = ['email', 'password', 'passkey'] as const
export type SignInMethod = (typeof SIGN_IN_METHODS)[number]

export const REGISTRATION_MODES = ['open', 'invite', 'closed'] as const
export type RegistrationMode = (typeof REGISTRATION_MODES)[number]

/** Ids the built-in providers use; a generic OIDC provider must pick another. */
const BUILT_IN_PROVIDERS = ['google', 'github', 'microsoft', 'discord']

const oidcProvider = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1).max(40),
  issuer: z.url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.array(z.string()).optional(),
})
export type OidcProviderConfig = z.infer<typeof oidcProvider>

const json = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return []
    try {
      return JSON.parse(v) as unknown
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON array' })
      return z.NEVER
    }
  })

export const identityConfig = defineSlice({
  title: 'Identity: sign-in methods, registration, tokens, passkeys, OAuth, 2FA',
  notes:
    'Generate the JWT keys, STEP_UP_CODE_SECRET and TOTP_ENCRYPTION_KEY with `bun run --filter @app/api keys:generate`.',
  example: {
    JWT_KID: 'dev-1',
    JWT_ISSUER: 'elysia-architecture',
    JWT_AUDIENCE: 'elysia-architecture-web',
  },
  schema: z
    .object({
      WEB_APP_URL: z
        .url()
        .default('http://localhost:5173')
        .describe(
          'Where the web app is served (same value as the core section): the OAuth redirect is `<WEB_APP_URL>/auth/oauth/callback`, and WebAuthn defaults follow it.',
        ),
      JWT_PRIVATE_KEY: pem.describe('ES256 private key (PKCS8 PEM, newlines as \\n).'),
      JWT_PUBLIC_KEY: pem.describe('ES256 public key (SPKI PEM, newlines as \\n).'),
      JWT_KID: z.string().default('dev-1').describe('Key id published in the JWKS.'),
      JWT_ISSUER: z.string().default('elysia-architecture').describe('`iss` of the access tokens.'),
      JWT_AUDIENCE: z
        .string()
        .default('elysia-architecture-web')
        .describe('`aud` of the access tokens.'),
      ACCESS_TOKEN_TTL: duration('15m').describe('Lifetime of an access token.'),
      REFRESH_TOKEN_TTL: duration('30d').describe('Lifetime of a refresh token (a session).'),
      STEP_UP_TTL: duration('5m').describe(
        'How long after signing in (or confirming again) sensitive actions — change email, add/remove a sign-in method — are allowed; after that the API answers 403 step_up_required.',
      ),
      STEP_UP_CODE_SECRET: z
        .string()
        .min(32)
        .describe(
          'Key for hashing the emailed step-up codes (HMAC, 32+ chars). Changing it invalidates the codes in flight (they live 10 minutes).',
        ),
      WEBAUTHN_RP_ID: blank.describe(
        'WebAuthn relying party id; defaults to the host of WEB_APP_URL. Changing it makes every registered passkey unusable.',
      ),
      WEBAUTHN_RP_NAME: z
        .string()
        .default('Elysia Architecture')
        .describe('Relying party name shown by the browser.'),
      WEBAUTHN_ORIGINS: blank
        .transform((v) => (v ? csv(v) : undefined))
        .describe(
          'Origins the browser may report during a passkey ceremony; defaults to the origin of WEB_APP_URL.',
        ),
      GOOGLE_CLIENT_ID: blank.describe(
        'Sign in with Google: a provider is on only when both its id and secret are set. Register `<WEB_APP_URL>/auth/oauth/callback` as the redirect URI.',
      ),
      GOOGLE_CLIENT_SECRET: blank.describe('Google client secret.'),
      GITHUB_CLIENT_ID: blank.describe('Sign in with GitHub (same rule as Google).'),
      GITHUB_CLIENT_SECRET: blank.describe('GitHub client secret.'),
      MICROSOFT_CLIENT_ID: blank.describe(
        'Sign in with Microsoft (Entra ID, same rule as Google). Only personal accounts, and work accounts whose tenant sends the `xms_edov` claim, have an email Microsoft vouches for.',
      ),
      MICROSOFT_CLIENT_SECRET: blank.describe('Microsoft client secret.'),
      MICROSOFT_TENANT: z
        .string()
        .default('common')
        .describe('`common` (any account), `consumers`, `organizations` or one tenant id.'),
      DISCORD_CLIENT_ID: blank.describe('Sign in with Discord (same rule as Google).'),
      DISCORD_CLIENT_SECRET: blank.describe('Discord client secret.'),
      OIDC_PROVIDERS: json
        .pipe(z.array(oidcProvider))
        .describe(
          'Any OpenID Connect provider (Keycloak, Auth0, Okta…), as a JSON array of `{"id","name","issuer","clientId","clientSecret","scopes"?}`. Endpoints come from the issuer\'s discovery document; the provider must send `email_verified`.',
        ),
      SIGN_IN_METHODS: list(SIGN_IN_METHODS, SIGN_IN_METHODS.join(',')).describe(
        'Ways to sign in, comma-separated: `email` (a link and a code by mail), `password`, `passkey`. OAuth providers are on when their credentials are set.',
      ),
      REGISTRATION_MODE: z
        .enum(REGISTRATION_MODES)
        .default('open')
        .describe(
          '`open`: anyone can create an account; `invite`: only addresses a member invited; `closed`: no new accounts.',
        ),
      REGISTRATION_EMAIL_DOMAINS: blank
        .transform((v) => (v ? csv(v).map((d) => d.toLowerCase()) : undefined))
        .describe(
          'Only addresses at these domains may create an account (comma-separated); unset = any domain.',
        ),
      REGISTRATION_ALLOWED_EMAILS: blank
        .transform((v) => (v ? csv(v).map((d) => d.toLowerCase()) : undefined))
        .describe(
          'Addresses that may always create an account, also when the mode is `invite` or `closed` (the owner who seeds the app).',
        ),
      TERMS_VERSION: blank.describe(
        'When set, creating an account requires accepting these terms; the version is recorded on the account.',
      ),
      TERMS_URL: blank
        .pipe(z.url().optional())
        .describe('Where the terms are published, linked from the sign-up page.'),
      PASSWORD_MIN_LENGTH: posInt(8).describe('Shortest password accepted (at most 128).'),
      TOTP_ENCRYPTION_KEY: blank
        .pipe(z.string().min(32).optional())
        .describe(
          'Two-factor authentication with an authenticator app is on when set: the key (32+ chars) that encrypts the stored TOTP secrets. Changing it locks every enrolled account out of password and email sign-in until the old key is back; unset, two-factor is off.',
        ),
      TOTP_ISSUER: blank.describe(
        'Name the authenticator app shows next to the code; defaults to WEBAUTHN_RP_NAME.',
      ),
      MAGIC_LINK_MAX_PER_EMAIL: posInt(3).describe(
        'Magic links one address can ask for within the throttle window.',
      ),
      MAGIC_LINK_MAX_PER_IP: posInt(10).describe(
        'Magic links one IP can ask for within the throttle window.',
      ),
    })
    .superRefine((env, ctx) => {
      allOrNone(ctx, {
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      })
      allOrNone(ctx, {
        GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
      })
      allOrNone(ctx, {
        MICROSOFT_CLIENT_ID: env.MICROSOFT_CLIENT_ID,
        MICROSOFT_CLIENT_SECRET: env.MICROSOFT_CLIENT_SECRET,
      })
      allOrNone(ctx, {
        DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: env.DISCORD_CLIENT_SECRET,
      })
      const ids = env.OIDC_PROVIDERS.map((p) => p.id)
      for (const [i, id] of ids.entries()) {
        if (BUILT_IN_PROVIDERS.includes(id) || ids.indexOf(id) !== i) {
          ctx.addIssue({
            code: 'custom',
            path: ['OIDC_PROVIDERS'],
            message: `provider id "${id}" is taken`,
          })
        }
      }
      if (env.PASSWORD_MIN_LENGTH > 128) {
        ctx.addIssue({
          code: 'custom',
          path: ['PASSWORD_MIN_LENGTH'],
          message: 'must be at most 128',
        })
      }
    }),
})

export type IdentityConfig = z.infer<typeof identityConfig.schema>
