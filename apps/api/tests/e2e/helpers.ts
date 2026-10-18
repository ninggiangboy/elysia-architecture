import { createLogger } from '@kit/telemetry'
import { buildApp } from '#/app'
import { loadAppConfig } from '#/bootstrap/config'
import { type ContainerOverrides, createContainer } from '#/bootstrap/container'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export async function createTestApp(
  overrides: ContainerOverrides = {},
  env: Record<string, string | undefined> = {},
) {
  const config = loadAppConfig({
    ...process.env,
    OUTBOX_POLL_INTERVAL_MS: '200',
    LOG_LEVEL: 'silent',
    // Generous mail rate limits so other tests are not deferred by the shared bucket.
    MAIL_RATE_PER_SECOND: '200',
    // Tests sign in several times within seconds and expect a push for each.
    PUSH_QUIET_WINDOW_SECONDS: '0',
    ...env,
  })
  const container = await createContainer(config, createLogger('silent'), overrides)
  container.startWorker()
  const app = buildApp(container)
  return { app, container, config }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

let ipCounter = 0
export const uniqueIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${++ipCounter % 250}`
export const uniqueEmail = (tag = 'user') =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`

export interface Call {
  token?: string
  body?: unknown
  cookie?: string
  ip?: string
  headers?: Record<string, string>
}

export function client(app: TestApp['app']) {
  return async (method: string, path: string, call: Call = {}) => {
    const headers: Record<string, string> = {
      'x-forwarded-for': call.ip ?? uniqueIp(),
      ...call.headers,
    }
    if (call.token) headers.authorization = `Bearer ${call.token}`
    if (call.cookie) headers.cookie = call.cookie
    if (call.body !== undefined) headers['content-type'] = 'application/json'
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      }),
    )
    const text = await res.text()
    // biome-ignore lint/suspicious/noExplicitAny: test helper — response shape asserted by each test
    let json: any
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = text
    }
    const setCookie = res.headers.get('set-cookie')
    return {
      status: res.status,
      json,
      headers: res.headers,
      /** "refresh_token=abc" — reuse as the `cookie` header. */
      refreshCookie: setCookie?.match(/refresh_token=([^;]*)/)?.[1]
        ? `refresh_token=${setCookie.match(/refresh_token=([^;]*)/)?.[1]}`
        : undefined,
      setCookie,
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function eventually<T>(
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 10_000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

interface MailSummary {
  ID: string
  Subject: string
}

export async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
  const data = (await res.json()) as { messages?: MailSummary[] }
  return data.messages ?? []
}

export async function countMails(address: string, subjectIncludes: string) {
  return (await mailsTo(address)).filter((m) => m.Subject.includes(subjectIncludes)).length
}

/** `skip` = number of mails of the same kind that already existed (to get the NEW mail when one address receives several). */
export async function waitForMail(address: string, subjectIncludes: string, skip = 0) {
  const summary = await eventually(
    async () => {
      const matches = (await mailsTo(address)).filter((m) => m.Subject.includes(subjectIncludes))
      return matches.length > skip ? matches[0] : undefined // Mailpit returns newest first
    },
    10_000,
    `mail "${subjectIncludes}" to ${address}`,
  )
  const res = await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`)
  const detail = (await res.json()) as { Text: string; Subject: string }
  const token = detail.Text.match(/token=([^\s&]+)/)?.[1]
  return {
    subject: detail.Subject,
    text: detail.Text,
    token: token ? decodeURIComponent(token) : undefined,
  }
}

export const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

/** Full sign-in via magic link; returns the access token + refresh cookie. */
export async function login(api: ReturnType<typeof client>, email: string, userAgent?: string) {
  const ip = uniqueIp()
  const before = await countMails(email, 'sign-in')
  const requested = await api('POST', '/api/auth/magic-link', { body: { email }, ip })
  if (requested.status !== 202) throw new Error(`magic link request failed: ${requested.status}`)
  const mail = await waitForMail(email, 'sign-in', before)
  const verified = await api('POST', '/api/auth/magic-link/verify', {
    body: { token: mail.token },
    ip,
    headers: userAgent ? { 'user-agent': userAgent } : undefined,
  })
  if (verified.status !== 200)
    throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.json)}`)
  return {
    accessToken: verified.json.accessToken as string,
    userId: verified.json.user.id as string,
    cookie: verified.refreshCookie as string,
  }
}

export interface SseMessage {
  id: string
  type: string
  data: Record<string, unknown>
  at: string
}

export const WAIT_MS = 5_000

/** Minimal SSE client over `app.handle`: buffers parsed events, lets a test await the next matching one. */
export async function openSse(
  app: TestApp['app'],
  token: string,
  options: { lastEventId?: string } = {},
) {
  const controller = new AbortController()
  const res = await app.handle(
    new Request('http://localhost/api/realtime/events', {
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.lastEventId ? { 'last-event-id': options.lastEventId } : {}),
      },
      signal: controller.signal,
    }),
  )
  const received: SseMessage[] = []
  const waiters: (() => void)[] = []
  let ended = false
  void (async () => {
    const reader = res.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf('\n\n')
        while (sep !== -1) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const data = block
            .split('\n')
            .find((l) => l.startsWith('data: '))
            ?.slice(6)
          const event = block
            .split('\n')
            .find((l) => l.startsWith('event: '))
            ?.slice(7)
          if (data && event === 'ready')
            received.push({ id: '', type: 'ready', data: JSON.parse(data), at: '' })
          else if (data) received.push(JSON.parse(data))
          for (const w of waiters.splice(0)) w()
          sep = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // aborted
    }
    ended = true
    for (const w of waiters.splice(0)) w()
  })()

  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    received,
    isClosed: () => ended,
    async next(type: string, match: (m: SseMessage) => boolean = () => true): Promise<SseMessage> {
      const deadline = Date.now() + WAIT_MS
      for (;;) {
        const found = received.find((m) => m.type === type && match(m))
        if (found) return found
        if (ended) throw new Error(`stream ended while waiting for ${type}`)
        const left = deadline - Date.now()
        if (left <= 0) throw new Error(`timed out waiting for ${type}`)
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, left)
        })
      }
    },
    close: () => controller.abort(),
  }
}
