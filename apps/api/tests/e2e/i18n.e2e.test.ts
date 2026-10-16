import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  client,
  createTestApp,
  eventually,
  type TestApp,
  uniqueEmail,
  waitForMail,
} from './helpers'

let t: TestApp
let api: ReturnType<typeof client>

beforeAll(async () => {
  t = await createTestApp()
  api = client(t.app)
})

afterAll(async () => {
  await t.container.close()
})

const VI = { 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8' }

/** Magic-link sign-in in a given browser language. */
async function signIn(
  email: string,
  headers: Record<string, string>,
  mailSubject = 'sign-in',
  skipMails = 0,
) {
  const requested = await api('POST', '/api/auth/magic-link', { body: { email }, headers })
  if (requested.status !== 202) throw new Error(`magic link request failed: ${requested.status}`)
  const mail = await waitForMail(email, mailSubject, skipMails)
  const verified = await api('POST', '/api/auth/magic-link/verify', {
    body: { token: mail.token },
    headers,
  })
  if (verified.status !== 200) throw new Error(`verify failed: ${verified.status}`)
  return {
    mail,
    accessToken: verified.json.accessToken as string,
    userId: verified.json.user.id as string,
  }
}

const templates = async (token: string) =>
  ((await api('GET', '/api/notifications', { token })).json.items as { template: string }[]).map(
    (i) => i.template,
  )

describe('languages', () => {
  test('a visitor browsing in Vietnamese gets a Vietnamese sign-in mail, account and welcome', async () => {
    const email = uniqueEmail('vi')
    const { mail, accessToken } = await signIn(email, VI, 'đăng nhập')
    expect(mail.subject).toBe('Liên kết đăng nhập của bạn')

    expect((await api('GET', '/api/me', { token: accessToken })).json.locale).toBe('vi')
    expect((await waitForMail(email, 'Chào mừng')).text).toContain(email)
    await eventually(
      async () => (await templates(accessToken)).includes('welcome'),
      10_000,
      'welcome notification',
    )
  })

  test('no Accept-Language, or one we do not speak, means English', async () => {
    const plain = await signIn(uniqueEmail('en'), {})
    expect(plain.mail.subject).toBe('Your sign-in link')
    expect((await api('GET', '/api/me', { token: plain.accessToken })).json.locale).toBe('en')

    const french = await signIn(uniqueEmail('fr'), { 'accept-language': 'fr-FR,fr;q=0.9' })
    expect(french.mail.subject).toBe('Your sign-in link')
  })

  test('a notification stores what it is made from, and the language comes with the reader', async () => {
    const email = uniqueEmail('switch')
    const first = await signIn(email, {})
    await eventually(
      async () => (await templates(first.accessToken)).includes('welcome'),
      10_000,
      'welcome notification',
    )

    const bad = await api('PUT', '/api/account/locale', {
      token: first.accessToken,
      body: { locale: 'fr' },
    })
    expect(bad.status).toBe(400)
    const saved = await api('PUT', '/api/account/locale', {
      token: first.accessToken,
      body: { locale: 'vi' },
    })
    expect(saved.status).toBe(204)
    expect((await api('GET', '/api/me', { token: first.accessToken })).json.locale).toBe('vi')

    // Signing in again from a browser that asks for English: the sign-in link follows the browser (the page that asked).
    await signIn(email, {}, 'sign-in', 1)
    // The "new sign-in" notification holds no text, only what the client writes it from, so it reads in whatever language
    // the reader has chosen — also after a later change.
    const alert = await eventually(
      async () =>
        (
          (await api('GET', '/api/notifications', { token: first.accessToken })).json.items as {
            template: string
            title: string
            data: { ip?: string }
          }[]
        ).find((n) => n.template === 'newSignIn'),
      10_000,
      'new sign-in notification',
    )
    expect(alert.title).toBe('')
    expect(alert.data).toHaveProperty('sessionId')
  })
})
