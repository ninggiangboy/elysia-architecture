import { buildApp } from '#/app'
import { type ContainerOverrides, createContainer } from '#/bootstrap/container'
import { loadConfig } from '#/shared/infrastructure/config'
import { createLogger } from '#/shared/infrastructure/logger'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export async function createTestApp(
  overrides: ContainerOverrides = {},
  env: Record<string, string> = {},
) {
  const config = loadConfig({
    ...process.env,
    OUTBOX_POLL_INTERVAL_MS: '200',
    LOG_LEVEL: 'silent',
    // Giới hạn gửi mail thoải mái để các test khác không bị hoãn vì bucket dùng chung.
    MAIL_RATE_PER_SECOND: '200',
    ...env,
  })
  const container = await createContainer(config, createLogger('silent'), overrides)
  container.relay.start()
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
      /** "refresh_token=abc" — dùng lại làm header `cookie`. */
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

/** `skip` = số mail cùng loại đã có từ trước (để lấy mail MỚI khi cùng địa chỉ nhận nhiều mail). */
export async function waitForMail(address: string, subjectIncludes: string, skip = 0) {
  const summary = await eventually(
    async () => {
      const matches = (await mailsTo(address)).filter((m) => m.Subject.includes(subjectIncludes))
      return matches.length > skip ? matches[0] : undefined // Mailpit trả mới nhất trước
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

/** Đăng nhập đầy đủ qua magic link; trả access token + refresh cookie. */
export async function login(api: ReturnType<typeof client>, email: string) {
  const ip = uniqueIp()
  const before = await countMails(email, 'đăng nhập')
  const requested = await api('POST', '/api/auth/magic-link', { body: { email }, ip })
  if (requested.status !== 202) throw new Error(`magic link request failed: ${requested.status}`)
  const mail = await waitForMail(email, 'đăng nhập', before)
  const verified = await api('POST', '/api/auth/magic-link/verify', {
    body: { token: mail.token },
    ip,
  })
  if (verified.status !== 200)
    throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.json)}`)
  return {
    accessToken: verified.json.accessToken as string,
    userId: verified.json.user.id as string,
    cookie: verified.refreshCookie as string,
  }
}
