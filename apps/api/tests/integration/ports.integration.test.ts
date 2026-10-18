import { afterAll, beforeAll } from 'bun:test'
import { withAdvisoryXactLock } from '@kit/db'
import { SmtpMailer } from '@kit/mail'
import { DrizzleInboxGuard, DrizzleOutboxWriter, inboxTable, outboxTable } from '@kit/messaging'
import { createObjectStorage } from '@kit/storage'
import {
  describeAdvisoryLock,
  describeInboxGuard,
  describeMailer,
  describeMailerFailures,
  describeObjectStorage,
  describeOutboxWriter,
  describeSendRateLimiter,
} from '@kit/testing/contracts'
import { PostgresSendRateLimiter } from '@mod/notification/testing'
import { inArray, sql } from 'drizzle-orm'
import { pgSchema } from 'drizzle-orm/pg-core'
import { startScriptedSmtpServer } from './scripted-smtp-server'
import { config, database, ensureContractTables, MAILPIT } from './support'

// The same suites that run on the fakes in packages/kit-testing, here on the real adapters. They need the dev stack
// (`bun run infra:up` and `bun run --filter @app/api db:migrate`).

beforeAll(ensureContractTables)
afterAll(() => database.close())

const contractSchema = pgSchema('contract_test')
const inbox = inboxTable(contractSchema)
const outbox = outboxTable(contractSchema)

describeObjectStorage('S3ObjectStorage (SeaweedFS)', () => ({
  storage: createObjectStorage({ ...config.storage, STORAGE_DRIVER: 's3' }),
}))

describeInboxGuard('DrizzleInboxGuard (Postgres)', () => ({
  guard: new DrizzleInboxGuard(database, inbox),
  cleanup: async () => {
    await database.db.execute(sql`delete from contract_test.inbox`)
  },
}))

describeOutboxWriter('DrizzleOutboxWriter (Postgres)', () => {
  const writer = new DrizzleOutboxWriter(database, outbox, () => crypto.randomUUID())
  const ids = new Set<string>()
  return {
    writer: {
      add: async (events) => {
        for (const e of events) ids.add(e.aggregateId)
        await writer.add(events)
      },
    },
    run: (fn) => database.run(fn),
    requiresUnitOfWork: true,
    written: async () => {
      if (ids.size === 0) return []
      const rows = await database.db
        .select()
        .from(outbox)
        .where(inArray(outbox.aggregateId, [...ids]))
        .orderBy(outbox.occurredAt)
      return rows.map((r) => ({
        type: r.type,
        aggregateId: r.aggregateId,
        payload: r.payload,
        occurredAt: r.occurredAt,
      }))
    },
    cleanup: async () => {
      if (ids.size > 0)
        await database.db.delete(outbox).where(inArray(outbox.aggregateId, [...ids]))
    },
  }
})

describeMailer('SmtpMailer (Mailpit)', () => ({
  mailer: new SmtpMailer(
    { host: config.mail.SMTP_HOST, port: config.mail.SMTP_PORT },
    'Contract <contract@example.test>',
  ),
  receivedBy: async (address) => {
    const found = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
    ).json()) as { messages?: { ID: string }[] }
    const messages = await Promise.all(
      (found.messages ?? []).map(
        async ({ ID }) =>
          (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
            Subject: string
            Text: string
            HTML: string
          },
      ),
    )
    // Mailpit lists the newest first.
    return messages.reverse().map((m) => ({ subject: m.Subject, text: m.Text, html: m.HTML }))
  },
}))

describeMailerFailures('SmtpMailer (scripted SMTP server)', () => {
  const smtp = startScriptedSmtpServer()
  return {
    mailer: new SmtpMailer(
      { host: '127.0.0.1', port: smtp.port },
      'Contract <contract@example.test>',
    ),
    failNext: {
      permanent: () => smtp.refuseNextRecipientAsMissingMailbox(),
      rateLimited: () => smtp.refuseNextRecipientAsThrottled(),
    },
    cleanup: async () => smtp.stop(),
  }
})

describeSendRateLimiter('PostgresSendRateLimiter (Postgres)', (options) => ({
  limiter: new PostgresSendRateLimiter(database, options),
  cleanup: async () => {
    await database.db.execute(sql`delete from notification.rate_buckets where key = ${options.key}`)
    await database.db.execute(sql`delete from notification.mail_quota where key = ${options.key}`)
  },
}))

describeAdvisoryLock('withAdvisoryXactLock (Postgres)', () => ({
  withLock: (key, fn) => withAdvisoryXactLock(database, key, fn),
}))
