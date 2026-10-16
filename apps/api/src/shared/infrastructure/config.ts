import { availableParallelism } from 'node:os'
import { z } from 'zod'
import { parseDurationSeconds } from './duration'

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const duration = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v, ctx) => {
      try {
        return parseDurationSeconds(v)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message })
        return z.NEVER
      }
    })

/** An empty variable (e.g. `${VAR:-}` in compose) counts as unset. */
const blank = z
  .string()
  .optional()
  .transform((v) => v || undefined)

const pem = z
  .string()
  .min(1)
  .transform((v) => v.replace(/\\n/g, '\n'))

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().default(3000),
    /** `api` serves HTTP; `worker` runs the outbox relay and with it every event handler, including the heavy ones (avatar thumbnails). */
    APP_ROLES: z
      .string()
      .default('api,worker')
      .transform(csv)
      .pipe(z.array(z.enum(['api', 'worker'])).min(1)),
    /** Cluster mode: number of processes sharing `PORT` (`auto` = 3/4 of the CPUs, min 2 so a crash never takes the whole instance down). 1 = single process, no supervisor. */
    APP_PROCESSES: z
      .string()
      .default('1')
      .transform((v, ctx) => {
        if (v === 'auto') return Math.max(2, Math.floor((availableParallelism() * 3) / 4))
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1) return n
        ctx.addIssue({ code: 'custom', message: 'must be a positive integer or "auto"' })
        return z.NEVER
      }),
    /** Set by the cluster supervisor (0-based). The outbox relay only runs in slot 0. Do not set by hand. */
    PROCESS_SLOT: z.coerce.number().int().nonnegative().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('').transform(csv),

    DATABASE_URL: z.string().min(1),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_PREPARE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    JWT_KID: z.string().default('dev-1'),
    JWT_ISSUER: z.string().default('elysia-architecture'),
    JWT_AUDIENCE: z.string().default('elysia-architecture-web'),
    ACCESS_TOKEN_TTL: duration('15m'),
    REFRESH_TOKEN_TTL: duration('30d'),

    /** How long after signing in (or confirming again) sensitive actions — change email, add/remove a sign-in method — are allowed. */
    STEP_UP_TTL: duration('5m'),

    /** WebAuthn relying party. Defaults follow WEB_APP_URL; set them when the web app is served from a different host than users type. */
    WEBAUTHN_RP_ID: blank,
    WEBAUTHN_RP_NAME: z.string().default('Elysia Architecture'),
    /** Origins the browser may report during a passkey ceremony. */
    WEBAUTHN_ORIGINS: blank.transform((v) => (v ? csv(v) : undefined)),

    /** OAuth sign-in. A provider is on only when both its id and secret are set. The redirect URI is `${WEB_APP_URL}/auth/oauth/callback`. */
    GOOGLE_CLIENT_ID: blank,
    GOOGLE_CLIENT_SECRET: blank,
    GITHUB_CLIENT_ID: blank,
    GITHUB_CLIENT_SECRET: blank,

    MAGIC_LINK_MAX_PER_EMAIL: z.coerce.number().int().positive().default(3),
    MAGIC_LINK_MAX_PER_IP: z.coerce.number().int().positive().default(10),

    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_REQUIRE_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    MAIL_FROM: z.string().default('App <no-reply@example.test>'),
    /** Maximum send rate (mails/second) — set to the "max send rate" of the SES account (sandbox: 1). */
    MAIL_RATE_PER_SECOND: z.coerce.number().positive().default(10),
    /** Number of mails that may be sent in one burst; defaults to ceil(rate). */
    MAIL_BURST: z.coerce.number().int().positive().optional(),
    /** Quota per day (UTC); 0 = unlimited. SES: "24-hour sending quota". */
    MAIL_DAILY_QUOTA: z.coerce.number().int().nonnegative().default(0),

    /** Web Push (VAPID). Leave all three unset to disable it; generate keys with `bun run keys:generate`. */
    VAPID_PUBLIC_KEY: blank,
    VAPID_PRIVATE_KEY: blank,
    VAPID_SUBJECT: blank,
    /** After a Web Push to a user, notifications in the same window of this length are stored but not pushed; 0 = push all. */
    PUSH_QUIET_WINDOW_SECONDS: z.coerce.number().int().nonnegative().default(30),
    /**
     * How long a disconnected SSE client can still replay the events that opted in (`session.revoked`) via `Last-Event-ID`.
     * Keep it at least ACCESS_TOKEN_TTL: after that a device that missed its sign-out can no longer refresh its session anyway.
     */
    REALTIME_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),

    /** OTLP/HTTP endpoint of a collector (Jaeger: http://localhost:4318). Leave unset to turn tracing off. */
    OTEL_EXPORTER_OTLP_ENDPOINT: blank.pipe(z.url().optional()),
    OTEL_SERVICE_NAME: z.string().default('elysia-architecture-api'),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    /** Messages claimed per relay batch. */
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(200),
    /** Aggregates processed in parallel per batch; keep below DB_POOL_MAX. Messages of one aggregate stay ordered. */
    OUTBOX_CONCURRENCY: z.coerce.number().int().positive().default(8),
    /** How long a claimed message stays reserved for this relay. Past it another relay may take it, so keep it above the slowest handler (image processing). */
    OUTBOX_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
    /** Maximum time a message may be deferred by the rate limit before it is considered dead. */
    OUTBOX_DEFER_BUDGET_HOURS: z.coerce.number().positive().default(24),
  })
  .superRefine((env, ctx) => {
    const set = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(
      Boolean,
    ).length
    if (set !== 0 && set !== 3)
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together',
      })
    for (const [name, id, secret] of [
      ['GOOGLE', env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
      ['GITHUB', env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
    ] as const) {
      if (Boolean(id) !== Boolean(secret))
        ctx.addIssue({
          code: 'custom',
          path: [`${name}_CLIENT_ID`],
          message: `${name}_CLIENT_ID and ${name}_CLIENT_SECRET must be set together`,
        })
    }
    if (env.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT))
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_SUBJECT'],
        message: 'VAPID_SUBJECT must be a mailto: or https:// URL',
      })
  })

const config = schema.transform((env) => {
  const webApp = new URL(env.WEB_APP_URL)
  return {
    ...env,
    WEBAUTHN_RP_ID: env.WEBAUTHN_RP_ID ?? webApp.hostname,
    WEBAUTHN_ORIGINS: env.WEBAUTHN_ORIGINS ?? [webApp.origin],
  }
})

export type Config = z.infer<typeof config>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = config.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${details}`)
  }
  return parsed.data
}
