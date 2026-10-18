import { allOrNone, blank, csv, defineSlice, duration, pem, posInt } from '@kit/config'
import { z } from 'zod'

export const identityConfig = defineSlice({
  title: 'Identity: tokens, passkeys, OAuth, magic links',
  notes:
    'Generate the JWT keys and STEP_UP_CODE_SECRET with `bun run --filter @app/api keys:generate`.',
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
    }),
})

export type IdentityConfig = z.infer<typeof identityConfig.schema>
