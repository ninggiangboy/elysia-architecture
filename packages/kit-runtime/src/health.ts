import { Elysia, t } from 'elysia'

export interface HealthCheck {
  /** Key in the readiness answer. */
  name: string
  /** Resolves when the dependency answers. */
  ping(): Promise<unknown>
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

const state = t.Union([t.Literal('up'), t.Literal('down')])

const readiness = t.Object({
  status: t.Union([t.Literal('ready'), t.Literal('degraded')]),
  database: state,
  /** Every other dependency the app registered (object storage, SMTP…), by name. Absent when there are none. */
  checks: t.Optional(t.Record(t.String(), state)),
  /** True while maintenance mode is on: the process is healthy but answers every other request 503. */
  maintenance: t.Boolean(),
})

export interface HealthOptions {
  /** The database check: always there, because a process without it cannot serve (and the deploy script reads it). */
  database: Pick<HealthCheck, 'ping'>
  /** More dependencies that must answer for the process to count as ready. */
  checks?: readonly HealthCheck[]
  maintenance: { readonly active: boolean }
  /** Per-check timeout. */
  timeoutMs?: number
}

/** `GET /health/live` (the process is up) and `GET /health/ready` (it can serve: dependencies answer; maintenance is reported, not failed). */
export function healthRoutes({
  database,
  checks = [],
  maintenance,
  timeoutMs = 2000,
}: HealthOptions) {
  const probe = (check: Pick<HealthCheck, 'ping'>) =>
    withTimeout(check.ping(), timeoutMs).then(
      () => 'up' as const,
      () => 'down' as const,
    )
  return new Elysia({ prefix: '/health', tags: ['health'] })
    .get('/live', () => ({ status: 'ok' as const }), {
      detail: {
        summary: 'Liveness',
        description: 'The process is alive. Does not check dependencies.',
      },
      response: { 200: t.Object({ status: t.Literal('ok') }) },
    })
    .get(
      '/ready',
      async ({ set }) => {
        const [db, ...others] = await Promise.all([database, ...checks].map(probe))
        const ready = db === 'up' && others.every((o) => o === 'up')
        if (!ready) set.status = 503
        return {
          status: ready ? ('ready' as const) : ('degraded' as const),
          database: db as 'up' | 'down',
          ...(checks.length > 0
            ? {
                checks: Object.fromEntries(
                  checks.map((c, i) => [c.name, others[i] as 'up' | 'down']),
                ),
              }
            : {}),
          maintenance: maintenance.active,
        }
      },
      {
        detail: {
          summary: 'Readiness',
          description:
            'Checks the database connection (and any other registered dependency); 503 if not ready. Stays ready in maintenance mode (and says so), so a deploy can tell a booted process from a dead one.',
        },
        response: {
          200: t.Object(readiness.properties, { description: 'Ready to accept requests' }),
          503: t.Object(readiness.properties, { description: 'A dependency is not responding' }),
        },
      },
    )
}
