import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type Mailer, MailPermanentError, MailRateLimitedError } from '@kit/mail'

export interface ReceivedMail {
  subject: string
  text: string
  html?: string
}

export interface MailerUnderTest {
  mailer: Mailer
  /** What has reached the address so far (Mailpit's API, a fake's list…), oldest first. */
  receivedBy(address: string): Promise<ReceivedMail[]>
  cleanup?(): Promise<void>
}

export interface FailingMailerUnderTest {
  mailer: Mailer
  /** Arms the next send to fail the way a provider does. */
  failNext: { permanent(): void; rateLimited(): void }
  cleanup?(): Promise<void>
}

const address = () => `contract-${crypto.randomUUID()}@example.test`

/** A Mailer delivers what it is given. */
export function describeMailer(
  name: string,
  make: () => Promise<MailerUnderTest> | MailerUnderTest,
) {
  describe(`Mailer contract: ${name}`, () => {
    let sut: MailerUnderTest
    beforeEach(async () => {
      sut = await make()
    })
    afterEach(async () => {
      await sut.cleanup?.()
    })

    const eventually = async <T>(read: () => Promise<T[]>, count: number) => {
      const deadline = Date.now() + 10_000
      for (;;) {
        const items = await read()
        if (items.length >= count || Date.now() > deadline) return items
        await Bun.sleep(100)
      }
    }

    test('delivers the subject and the text to the address', async () => {
      const to = address()
      await sut.mailer.send({
        to,
        subject: 'Hello there',
        text: 'Plain body',
        html: '<p>Plain body</p>',
      })
      const [mail] = await eventually(() => sut.receivedBy(to), 1)
      expect(mail?.subject).toBe('Hello there')
      expect(mail?.text.trim()).toBe('Plain body')
    })

    test('keeps the HTML version and non-ASCII text intact', async () => {
      const to = address()
      await sut.mailer.send({
        to,
        subject: 'Xin chào — ✓',
        text: 'Đăng nhập',
        html: '<p><b>Đăng nhập</b></p>',
      })
      const [mail] = await eventually(() => sut.receivedBy(to), 1)
      expect(mail?.subject).toBe('Xin chào — ✓')
      expect(mail?.text.trim()).toBe('Đăng nhập')
      expect(mail?.html).toContain('<b>Đăng nhập</b>')
    })

    test('every mail sent is delivered, to its own address', async () => {
      const [a, b] = [address(), address()]
      await sut.mailer.send({ to: a, subject: 'for a', text: 'a', html: 'a' })
      await sut.mailer.send({ to: b, subject: 'for b', text: 'b', html: 'b' })
      expect((await eventually(() => sut.receivedBy(a), 1)).map((m) => m.subject)).toEqual([
        'for a',
      ])
      expect((await eventually(() => sut.receivedBy(b), 1)).map((m) => m.subject)).toEqual([
        'for b',
      ])
    })
  })
}

/** A Mailer tells a mail that can never be sent from one that only has to wait. */
export function describeMailerFailures(
  name: string,
  make: () => Promise<FailingMailerUnderTest> | FailingMailerUnderTest,
) {
  describe(`Mailer failures contract: ${name}`, () => {
    let sut: FailingMailerUnderTest
    beforeEach(async () => {
      sut = await make()
    })
    afterEach(async () => {
      await sut.cleanup?.()
    })

    test('a mail that can never be sent is a MailPermanentError', async () => {
      sut.failNext.permanent()
      await expect(
        sut.mailer.send({ to: address(), subject: 's', text: 't', html: 'h' }),
      ).rejects.toBeInstanceOf(MailPermanentError)
    })

    test('a refusal because of rate or quota is a MailRateLimitedError', async () => {
      sut.failNext.rateLimited()
      await expect(
        sut.mailer.send({ to: address(), subject: 's', text: 't', html: 'h' }),
      ).rejects.toBeInstanceOf(MailRateLimitedError)
    })

    test('after a refusal the mailer works again', async () => {
      sut.failNext.rateLimited()
      await sut.mailer.send({ to: address(), subject: 's', text: 't', html: 'h' }).catch(() => {})
      await sut.mailer.send({ to: address(), subject: 's', text: 't', html: 'h' })
    })
  })
}
