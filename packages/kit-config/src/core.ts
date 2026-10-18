import { availableParallelism } from 'node:os'
import { z } from 'zod'
import { defineSlice } from './define'
import { csv } from './helpers'

export const coreConfig = defineSlice({
  title: 'API process',
  example: { CORS_ORIGINS: 'http://localhost:5173' },
  schema: z.object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('production')
      .describe('Runtime mode. The OpenAPI docs are served only in development.'),
    PORT: z.coerce.number().int().default(3000).describe('Port the API listens on.'),
    APP_ROLES: z
      .string()
      .default('api,worker')
      .transform(csv)
      .pipe(z.array(z.enum(['api', 'worker'])).min(1))
      .describe(
        '`api` serves HTTP; `worker` runs the outbox relay and with it every event handler, including the heavy ones (avatar thumbnails). Split them: `api` on web boxes, `worker` on their own.',
      ),
    APP_PROCESSES: z
      .string()
      .default('1')
      .transform((v, ctx) => {
        if (v === 'auto') return Math.max(2, Math.floor((availableParallelism() * 3) / 4))
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1) return n
        ctx.addIssue({ code: 'custom', message: 'must be a positive integer or "auto"' })
        return z.NEVER
      })
      .describe(
        'Cluster mode: processes sharing PORT (a number, or `auto` = 3/4 of the CPUs, min 2 so a crash never takes the whole instance down). 1 = single process, no supervisor. DB_POOL_MAX is per process.',
      ),
    PROCESS_SLOT: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Set by the cluster supervisor (0-based); the outbox relay only runs in slot 0. Do not set by hand.',
      ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info')
      .describe('Log verbosity.'),
    WEB_APP_URL: z
      .url()
      .default('http://localhost:5173')
      .describe('Where the web app is served: links in mails, OAuth redirects, WebAuthn defaults.'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform(csv)
      .describe('Origins allowed to call the API from a browser, comma separated.'),
  }),
})
