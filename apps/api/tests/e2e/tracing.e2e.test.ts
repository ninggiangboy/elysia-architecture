import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { sql } from 'drizzle-orm'
import {
  client,
  createTestApp,
  eventually,
  login,
  type TestApp,
  uniqueEmail,
  waitForMail,
} from './helpers'

// Spans are collected in-process, so these tests only see the messages THIS process's relay handles. Another relay
// on the same database (e.g. a running `bun run dev`) can claim a message first; draining every few ms instead of the
// relay's poll interval makes that rare enough not to matter locally (CI has no second relay).
const exporter = new InMemorySpanExporter()
let provider: NodeTracerProvider
let t: TestApp
let api: ReturnType<typeof client>
let pump: ReturnType<typeof setInterval>

beforeAll(async () => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  provider.register()
  t = await createTestApp()
  api = client(t.app)
  const { identity, profile, notification } = t.container.modules
  await t.container.relay.stop()
  let busy = false
  pump = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      for (const source of [identity.outbox, profile.outbox, notification.outbox])
        await t.container.relay.drain(source)
    } finally {
      busy = false
    }
  }, 20)
})

afterAll(async () => {
  clearInterval(pump)
  await t.container.close()
  await provider.shutdown()
})

const inTrace = (traceId: string) =>
  exporter.getFinishedSpans().filter((s) => s.spanContext().traceId === traceId)
const parentIdOf = (s: ReadableSpan) => s.parentSpanContext?.spanId

describe('tracing through the outbox', () => {
  test('request → relay → handler is one trace, parent linked at every hop', async () => {
    const email = uniqueEmail('trace')
    const res = await api('POST', '/api/auth/magic-link', { body: { email } })
    expect(res.status).toBe(202)
    await waitForMail(email, 'sign-in')

    const http = await eventually(async () =>
      exporter
        .getFinishedSpans()
        .find((s) => s.name.startsWith('POST') && s.name.endsWith('/auth/magic-link')),
    )
    const traceId = http.spanContext().traceId
    const spans = await eventually(async () => {
      const found = inTrace(traceId)
      return found.some((s) => s.name.startsWith('handle ')) ? found : undefined
    })

    const relay = spans.find((s) => s.name.startsWith('outbox.relay '))
    const handler = spans.find((s) => s.name.startsWith('handle '))
    expect(relay).toBeDefined()
    expect(handler).toBeDefined()
    expect(parentIdOf(relay as ReadableSpan)).toBe(http.spanContext().spanId)
    expect(parentIdOf(handler as ReadableSpan)).toBe(relay?.spanContext().spanId)
    expect(http.attributes['http.response.status_code']).toBe(202)
    expect(relay?.attributes['messaging.message.id']).toBeString()

    // The outbox row carries the same trace, so the link survives a restart between write and relay.
    const rows = await t.container.database.db.execute<{ headers: Record<string, string> }>(
      sql`select headers from identity.outbox_messages where payload->>'email' = ${email}`,
    )
    expect(rows[0]?.headers.traceparent).toContain(traceId)
  })

  test('a handler that emits a follow-up event keeps the same trace across the second hop', async () => {
    const email = uniqueEmail('trace-chain')
    await login(api, email)

    // Verifying the link registers the user → CreateNotificationHandler writes notification.created.v1 to its own outbox.
    const http = await eventually(async () =>
      exporter.getFinishedSpans().find((s) => s.name.endsWith('/auth/magic-link/verify')),
    )
    const traceId = http.spanContext().traceId
    const relays = await eventually(async () => {
      const found = inTrace(traceId).filter((s) => s.name.startsWith('outbox.relay '))
      const sources = new Set(found.map((s) => s.attributes['outbox.source']))
      return sources.has('identity') && sources.has('notification') ? found : undefined
    })
    expect(relays.length).toBeGreaterThanOrEqual(2)
  })

  test('an incoming traceparent is continued, not replaced', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const res = await api('GET', '/api/nope', {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    })
    expect(res.status).toBe(404)
    const span = await eventually(async () => inTrace(traceId)[0])
    expect(parentIdOf(span)).toBe('00f067aa0ba902b7')
  })
})
