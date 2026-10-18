import { expect, test } from 'bun:test'
import { ConsoleMailer } from './console-mailer'

const record = () => {
  const lines: { fields: Record<string, unknown>; message: string }[] = []
  const log = {
    info: (fields: object, message: string) =>
      lines.push({ fields: fields as Record<string, unknown>, message }),
    warn() {},
    error() {},
  }
  return { lines, log }
}
const mail = {
  to: 'a@b.co',
  subject: 'Your sign-in link',
  text: 'Open https://app.test/auth/callback?token=abc now',
  html: '<p>x</p>',
}

test('logs the recipient and subject, and sends nothing', async () => {
  const { lines, log } = record()
  await new ConsoleMailer(log).send(mail)
  expect(lines).toHaveLength(1)
  expect(lines[0]?.fields).toEqual({ to: 'a@b.co', subject: 'Your sign-in link' })
})

test('prints the links of the mail when asked, and only then', async () => {
  const { lines, log } = record()
  await new ConsoleMailer(log, { printLinks: true }).send(mail)
  expect(lines[0]?.fields.links).toEqual(['https://app.test/auth/callback?token=abc'])
})
