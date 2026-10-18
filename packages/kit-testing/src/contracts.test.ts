import {
  describeAdvisoryLock,
  describeInboxGuard,
  describeMailer,
  describeMailerFailures,
  describeObjectStorage,
  describeOutboxWriter,
  describeSendRateLimiter,
} from './contracts'
import {
  FakeStorage,
  InMemoryAdvisoryLock,
  InMemoryInbox,
  InMemoryOutbox,
  InMemorySendRateLimiter,
  MemoryMailer,
} from './fakes'

// The same suites run on the real adapters (apps/api/tests/integration): a fake that drifts from them turns one side red.

describeObjectStorage('FakeStorage', () => ({ storage: new FakeStorage() }))

describeInboxGuard('InMemoryInbox', () => {
  const inbox = new InMemoryInbox()
  return { guard: inbox, crashAfterNextSideEffect: () => inbox.crashAfterNextSideEffect() }
})

describeOutboxWriter('InMemoryOutbox', () => {
  const outbox = new InMemoryOutbox()
  return { writer: outbox, written: async () => outbox.events }
})

describeMailer('MemoryMailer', () => {
  const mailer = new MemoryMailer()
  return {
    mailer,
    receivedBy: async (address) =>
      mailer.to(address).map((m) => ({ subject: m.subject, text: m.text, html: m.html })),
  }
})

describeMailerFailures('MemoryMailer', () => {
  const mailer = new MemoryMailer()
  return {
    mailer,
    failNext: {
      permanent: () => mailer.failNextPermanently(),
      rateLimited: () => mailer.failNextRateLimited(),
    },
  }
})

describeSendRateLimiter('InMemorySendRateLimiter', (options) => ({
  limiter: new InMemorySendRateLimiter(options),
}))

describeAdvisoryLock('InMemoryAdvisoryLock', () => ({
  withLock: new InMemoryAdvisoryLock().withLock,
}))
