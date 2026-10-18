import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../src/app'
import { loadAppConfig } from '../../src/bootstrap/config'
import { createContainer } from '../../src/bootstrap/container'
import { client, eventually, uniqueEmail, uniqueIp } from './helpers'

// The app with STORAGE_DRIVER=local and MAIL_DRIVER=console: no S3 service and no mail server, only Postgres.

type Container = Awaited<ReturnType<typeof createContainer>>
let dir: string
let container: Container
let api: ReturnType<typeof client>
const logged: { fields: Record<string, unknown>; message: string }[] = []

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'local-drivers-'))
  const config = loadAppConfig({
    ...process.env,
    LOG_LEVEL: 'silent',
    OUTBOX_POLL_INTERVAL_MS: '200',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: dir,
    STORAGE_LOCAL_SECRET: 'e2e-local-secret-e2e-local-secret-0000',
    STORAGE_LOCAL_PUBLIC_URL: 'http://localhost/api',
    S3_ENDPOINT: undefined,
    S3_PUBLIC_ENDPOINT: undefined,
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    MAIL_DRIVER: 'console',
    // Nothing listens here: if the app tried SMTP, the sign-in below would never complete.
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '9',
  })
  const log = {
    info: (fields: object, message: string) =>
      void logged.push({ fields: fields as Record<string, unknown>, message }),
    warn() {},
    error() {},
    debug() {},
    fatal() {},
    trace() {},
    child: () => log,
    level: 'silent',
  }
  container = await createContainer(config, log as never)
  container.startWorker()
  api = client(buildApp(container))
})

afterAll(async () => {
  await container.close()
  await rm(dir, { recursive: true, force: true })
})

describe('local storage and console mail', () => {
  test('signs in with a link printed in the log, no mail server involved', async () => {
    const email = uniqueEmail('console')
    const ip = uniqueIp()
    expect((await api('POST', '/api/auth/magic-link', { body: { email }, ip })).status).toBe(202)

    const link = await eventually(async () => {
      const mail = logged.find(
        (l) => l.message.includes('MAIL_DRIVER=console') && l.fields.to === email,
      )
      return (mail?.fields.links as string[] | undefined)?.[0]
    })
    const token = new URL(link).searchParams.get('token')
    const verified = await api('POST', '/api/auth/magic-link/verify', { body: { token }, ip })
    expect(verified.status).toBe(200)
    expect((await api('GET', '/api/me', { token: verified.json.accessToken })).status).toBe(200)
  })

  test('a file goes up and comes back through links the API itself serves', async () => {
    const put = container.storage.presignPut('e2e/hello.txt', {
      contentType: 'text/plain',
      expiresInSeconds: 60,
    })
    const path = new URL(put)
    const app = buildApp(container)
    const uploaded = await app.handle(
      new Request(`http://localhost${path.pathname}${path.search}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'hello from the disk',
      }),
    )
    expect(uploaded.status).toBe(200)

    const get = new URL(container.storage.presignGet('e2e/hello.txt', 60))
    const downloaded = await app.handle(new Request(`http://localhost${get.pathname}${get.search}`))
    expect(await downloaded.text()).toBe('hello from the disk')
  })
})
