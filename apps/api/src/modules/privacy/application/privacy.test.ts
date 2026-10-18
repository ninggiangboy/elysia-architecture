import { beforeEach, describe, expect, test } from 'bun:test'
import { StepUpPolicy } from '@kit/auth'
import type { DomainEvent } from '@kit/core'
import { ConflictError } from '@kit/core'
import type { Envelope, IntegrationEventHandler } from '@kit/messaging'
import {
  type DataEraser,
  type DataExporter,
  EraseUserDataHandler,
  ExportUserDataHandler,
} from '@kit/privacy-participant'
import {
  FakeClock,
  FakeStorage,
  InMemoryInbox,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '@kit/testing'
import { unzipSync } from 'fflate'
import type { IdentityApi } from '#/modules/identity/contracts'
import {
  type AccountErasureRequestedPayload,
  type DataExportRequestedPayload,
  PrivacyEvents,
  participantEvents,
} from '../contracts/events'
import type { AccountDeletion } from '../domain/account-deletion'
import type { DataExport } from '../domain/data-export'
import type { AccountDeletionRepository, DataExportRepository } from '../domain/repositories'
import { ZipArchiveBuilder } from '../infrastructure/zip-archive-builder'
import { AssembleExport } from './handlers/assemble-export'
import { RecordErasure } from './handlers/record-erasure'
import { RecordExportPart } from './handlers/record-export-part'
import { exportArchiveKey, exportFolder } from './keys'
import type { PrivacyPolicy } from './ports'
import { PrivacyJobs } from './privacy-jobs'
import {
  CancelAccountDeletion,
  GetAccountDeletion,
  ResumeStalledDeletion,
  ScheduleAccountDeletion,
} from './use-cases/account-deletion'
import { GetExportDownload, RequestDataExport } from './use-cases/data-export'

const MINUTE = 60_000
const DAY = 86_400_000
const USER = '00000000-0000-7000-8000-00000000a11c'
const OTHER = '00000000-0000-7000-8000-0000000000b0'

class MemExports implements DataExportRepository {
  rows = new Map<string, DataExport>()
  async add(e: DataExport) {
    const active = [...this.rows.values()].some((r) => r.userId === e.userId && r.isActive())
    if (active) throw new ConflictError('export_in_progress', 'busy')
    this.rows.set(e.id, e)
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null
  }
  async findByUserAndId(userId: string, id: string) {
    const e = this.rows.get(id)
    return e && e.userId === userId ? e : null
  }
  async listByUser(userId: string, limit: number) {
    return [...this.rows.values()].filter((r) => r.userId === userId).slice(0, limit)
  }
  async save(e: DataExport) {
    this.rows.set(e.id, e)
  }
  async claimStalled(quietBefore: Date, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.isActive() && r.props.updatedAt <= quietBefore)
      .slice(0, limit)
  }
  async claimExpired(now: Date, limit: number) {
    return [...this.rows.values()]
      .filter(
        (r) => r.status === 'ready' && (r.props.expiresAt?.getTime() ?? Infinity) <= now.getTime(),
      )
      .slice(0, limit)
  }
}

class MemDeletions implements AccountDeletionRepository {
  rows = new Map<string, AccountDeletion>()
  async add(d: AccountDeletion) {
    if (await this.findActiveByUser(d.userId))
      throw new ConflictError('deletion_already_scheduled', 'already')
    this.rows.set(d.id, d)
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null
  }
  async findActiveByUser(userId: string) {
    return (
      [...this.rows.values()].find(
        (r) => r.userId === userId && ['scheduled', 'running', 'stalled'].includes(r.status),
      ) ?? null
    )
  }
  async save(d: AccountDeletion) {
    this.rows.set(d.id, d)
  }
  async claimDue(now: Date, limit: number) {
    return [...this.rows.values()].filter((r) => r.isDue(now)).slice(0, limit)
  }
  async claimStalled(quietBefore: Date, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'running' && r.props.updatedAt <= quietBefore)
      .slice(0, limit)
  }
}

const policy: PrivacyPolicy = {
  exportParticipants: ['identity', 'profile'],
  // `ledger` is a module that lives in another service: nothing in this process knows it, only its events.
  deletionParticipants: ['identity', 'profile', 'privacy', 'ledger'],
  deletionGraceMs: 14 * DAY,
  exportTtlMs: 7 * DAY,
  stallAfterMs: 10 * MINUTE,
  maxNudges: 2,
}

const identity: IdentityApi = {
  getAccount: async (id) =>
    id === 'ghost'
      ? null
      : { id, email: `${id}@x.co`, locale: 'en', createdAt: '2026-01-01T00:00:00.000Z' },
}

/** A fresh login (auth_time = now), or none. */
const fresh = (clock: FakeClock) => Math.floor(clock.now().getTime() / 1000)

describe('privacy', () => {
  let clock: FakeClock
  let storage: FakeStorage
  let outbox: InMemoryOutbox
  let inbox: InMemoryInbox
  let exports: MemExports
  let deletions: MemDeletions
  let ids: SequentialIds
  let handlers: IntegrationEventHandler[]
  let delivered: number
  /** Modules whose eraser fails this many more times. */
  let failures: Record<string, number>
  let erased: string[]
  /** What the out-of-process `ledger` service does when asked; `null` = it is down. */
  let ledgerAnswers: boolean
  const log = { info() {}, warn() {}, error() {} }
  const stepUp = () => new StepUpPolicy(clock, 300)

  const exporter = (data: object, files: { path: string; key: string }[] = []): DataExporter => ({
    collect: async () => ({ data, files }),
  })
  const eraser = (module: string): DataEraser => ({
    erase: async (userId) => {
      if ((failures[module] ?? 0) > 0) {
        failures[module] = (failures[module] ?? 0) - 1
        throw new Error(`${module} is having a bad day`)
      }
      erased.push(`${module}:${userId}`)
    },
  })

  beforeEach(() => {
    clock = new FakeClock()
    storage = new FakeStorage()
    outbox = new InMemoryOutbox()
    inbox = new InMemoryInbox()
    exports = new MemExports()
    deletions = new MemDeletions()
    ids = new SequentialIds()
    delivered = 0
    failures = {}
    erased = []
    ledgerAnswers = true
    storage.data.set(`${USER}/avatar.png`, new Uint8Array([1, 2, 3]))

    const participant = (
      module: string,
      data: object,
      files: { path: string; key: string }[] = [],
    ) => [
      new ExportUserDataHandler<DataExportRequestedPayload>(
        {
          name: `${module}.export`,
          module,
          requestType: PrivacyEvents.DataExportRequested,
          answerType: participantEvents(module).dataExported,
        },
        exporter(data, files),
        storage,
        outbox,
        inbox,
        clock,
      ),
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: `${module}.erase`,
          module,
          requestType: PrivacyEvents.AccountErasureRequested,
          answerType: participantEvents(module).userDataErased,
        },
        eraser(module),
        outbox,
        inbox,
        clock,
      ),
    ]
    /** A module in another service: it only reads the request and writes the answer, with its own code. */
    const ledger: IntegrationEventHandler = {
      name: 'ledger.erase',
      eventType: PrivacyEvents.AccountErasureRequested,
      handle: async (message) => {
        if (!ledgerAnswers) return
        const p = message.payload as unknown as AccountErasureRequestedPayload
        if (!p.modules.includes('ledger')) return
        await outbox.add([
          {
            type: participantEvents('ledger').userDataErased,
            aggregateId: p.userId,
            payload: {
              deletionId: p.deletionId,
              userId: p.userId,
              module: 'ledger',
              erasedAt: clock.now().toISOString(),
            },
            occurredAt: clock.now(),
          },
        ])
      },
    }
    handlers = [
      ...participant('identity', { account: { email: 'a@x.co' } }),
      ...participant('profile', { displayName: 'Alice' }, [
        { path: 'profile/avatar.png', key: `${USER}/avatar.png` },
      ]),
      ...policy.exportParticipants.map(
        (m) => new RecordExportPart(m, exports, outbox, inbox, clock),
      ),
      new AssembleExport(
        exports,
        identity,
        storage,
        new ZipArchiveBuilder(),
        policy,
        outbox,
        inbox,
        clock,
        log,
      ),
      ...policy.deletionParticipants.map(
        (m) => new RecordErasure(m, deletions, outbox, inbox, clock),
      ),
      // Privacy's own eraser stands in with the same shape as the others.
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: 'privacy.erase',
          module: 'privacy',
          requestType: PrivacyEvents.AccountErasureRequested,
          answerType: participantEvents('privacy').userDataErased,
        },
        eraser('privacy'),
        outbox,
        inbox,
        clock,
      ),
      ledger,
    ]
  })

  /** A tiny relay: hands every event not yet delivered to the handlers subscribed to it; a failing handler is retried by the next call. */
  async function deliverAll(options: { rounds?: number } = {}) {
    for (let round = 0; round < (options.rounds ?? 20); round++) {
      const pending = outbox.events.slice(delivered)
      if (pending.length === 0) return
      delivered = outbox.events.length
      for (const event of pending) {
        const envelope: Envelope = {
          id: ids.next(),
          type: event.type,
          source: 'test',
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt.toISOString(),
          payload: event.payload,
          headers: {},
        }
        for (const handler of handlers.filter((h) => h.eventType === event.type)) {
          try {
            await handler.handle(envelope)
          } catch {
            // The real relay would retry the whole message with backoff; the test re-queues it by hand where it matters.
            failed.push({ handler, envelope })
          }
        }
      }
    }
  }
  let failed: { handler: IntegrationEventHandler; envelope: Envelope }[] = []
  beforeEach(() => {
    failed = []
  })
  /** The relay's retry of whatever failed. */
  async function retryFailed() {
    const again = failed.splice(0)
    for (const { handler, envelope } of again) {
      try {
        await handler.handle(envelope)
      } catch {
        failed.push({ handler, envelope })
      }
    }
    await deliverAll()
  }

  const eventsOf = (type: string): DomainEvent[] => outbox.events.filter((e) => e.type === type)
  const jobs = () =>
    new PrivacyJobs(
      exports,
      deletions,
      storage,
      policy,
      outbox,
      new PassthroughUnitOfWork(),
      clock,
      log,
    )
  const requestExport = (userId = USER, authTime: number | 'none' | 'now' = 'now') =>
    new RequestDataExport(
      exports,
      deletions,
      identity,
      policy,
      stepUp(),
      outbox,
      new PassthroughUnitOfWork(),
      ids,
      clock,
    ).execute({
      userId,
      authTime: authTime === 'now' ? fresh(clock) : authTime === 'none' ? undefined : authTime,
    })
  const scheduleDeletion = (userId = USER, authTime: number | 'none' | 'now' = 'now') =>
    new ScheduleAccountDeletion(
      deletions,
      identity,
      policy,
      stepUp(),
      outbox,
      new PassthroughUnitOfWork(),
      ids,
      clock,
    ).execute({
      userId,
      authTime: authTime === 'now' ? fresh(clock) : authTime === 'none' ? undefined : authTime,
    })
  const cancelDeletion = (userId = USER) =>
    new CancelAccountDeletion(deletions, outbox, new PassthroughUnitOfWork(), clock).execute({
      userId,
    })

  describe('data export', () => {
    test('asks every module for its part, under a folder that only this export uses', async () => {
      const view = await requestExport()
      expect(view.status).toBe('collecting')
      expect(view.modules).toEqual([
        { module: 'identity', done: false },
        { module: 'profile', done: false },
      ])
      const [requested] = eventsOf(PrivacyEvents.DataExportRequested)
      expect(requested?.payload).toMatchObject({
        exportId: view.id,
        userId: USER,
        modules: ['identity', 'profile'],
        uploadPrefix: `exports/${USER}/${view.id}/parts/`,
      })
    })

    test('needs a recent confirmation', async () => {
      await expect(requestExport(USER, 'none')).rejects.toMatchObject({
        code: 'step_up_required',
      })
      // Confirmed ten minutes ago: older than the five-minute window.
      const confirmedAt = fresh(clock)
      clock.advance(10 * MINUTE)
      await expect(requestExport(USER, confirmedAt)).rejects.toMatchObject({
        code: 'step_up_required',
      })
    })

    test('one export at a time; an unknown account is not served', async () => {
      await requestExport()
      await expect(requestExport()).rejects.toMatchObject({ code: 'export_in_progress' })
      await expect(requestExport('ghost')).rejects.toMatchObject({ code: 'user_not_found' })
    })

    test('is refused while the account is being erased', async () => {
      await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      await expect(requestExport(USER, fresh(clock))).rejects.toMatchObject({
        code: 'account_being_deleted',
      })
    })

    test('modules deliver, the archive is built, the user is told — with the link in the event, not in the progress', async () => {
      const view = await requestExport()
      await deliverAll()

      const saved = await exports.findById(view.id)
      expect(saved?.status).toBe('ready')
      expect(eventsOf(PrivacyEvents.DataExportProgressed).map((e) => e.payload.done)).toEqual([
        1, 2,
      ])

      const [ready] = eventsOf(PrivacyEvents.DataExportReady)
      expect(ready?.payload).toMatchObject({
        exportId: view.id,
        userId: USER,
        email: `${USER}@x.co`,
        expiresAt: new Date(clock.now().getTime() + 7 * DAY).toISOString(),
      })
      expect(String(ready?.payload.downloadUrl)).toContain(exportArchiveKey(USER, view.id))
      // Progress events are replayed to clients and stored: they must never carry the link.
      for (const e of eventsOf(PrivacyEvents.DataExportProgressed))
        expect(JSON.stringify(e.payload)).not.toContain('http')

      const archive = unzipSync((await storage.read(exportArchiveKey(USER, view.id))) as Uint8Array)
      expect(Object.keys(archive).sort()).toEqual([
        'README.txt',
        'data/identity.json',
        'data/profile.json',
        'files/profile/avatar.png',
      ])
      expect(JSON.parse(new TextDecoder().decode(archive['data/profile.json']))).toEqual({
        displayName: 'Alice',
      })
      expect([...(archive['files/profile/avatar.png'] ?? [])]).toEqual([1, 2, 3])
      // The parts were only a means.
      expect([...storage.data.keys()].filter((k) => k.includes('/parts/'))).toEqual([])
    })

    test('answers that arrive twice or out of order are counted once', async () => {
      const view = await requestExport()
      await deliverAll({ rounds: 1 })
      // Replay every answer.
      const answers = outbox.events.filter((e) => e.type.endsWith('.data_exported.v1'))
      for (const answer of answers) outbox.events.push({ ...answer })
      await deliverAll()
      expect(eventsOf(PrivacyEvents.DataExportReady)).toHaveLength(1)
      expect((await exports.findById(view.id))?.status).toBe('ready')
    })

    test('a module can only deliver the part that is its own', async () => {
      const view = await requestExport()
      // `profile` answers claiming to be `identity`: the answer is recorded under the module that was wired to hear it.
      await outbox.add([
        {
          type: participantEvents('profile').dataExported,
          aggregateId: USER,
          payload: {
            exportId: view.id,
            userId: USER,
            module: 'identity',
            key: 'x',
            size: 1,
            files: [],
          },
          occurredAt: clock.now(),
        },
      ])
      handlers = handlers.filter((h) => h.name.startsWith('privacy.record-export-part'))
      await deliverAll()
      expect((await exports.findById(view.id))?.pendingModules()).toEqual(['identity'])
    })

    test('a module that stays silent is asked again — only it — and the export fails when it never answers', async () => {
      const view = await requestExport()
      handlers = handlers.filter((h) => h.name !== 'profile.export')
      await deliverAll()
      expect((await exports.findById(view.id))?.pendingModules()).toEqual(['profile'])

      clock.advance(10 * MINUTE)
      expect(await jobs().runOnce()).toMatchObject({ nudged: 1 })
      const requests = eventsOf(PrivacyEvents.DataExportRequested)
      expect(requests).toHaveLength(2)
      expect(requests[1]?.payload.modules).toEqual(['profile'])

      clock.advance(10 * MINUTE)
      await jobs().runOnce()
      clock.advance(10 * MINUTE)
      expect(await jobs().runOnce()).toMatchObject({ failed: 1 })
      expect((await exports.findById(view.id))?.status).toBe('failed')
      expect(eventsOf(PrivacyEvents.DataExportFailed)).toHaveLength(1)
      // The user can try again.
      await expect(requestExport(USER, fresh(clock))).resolves.toMatchObject({
        status: 'collecting',
      })
    })

    test('a re-sent request to everyone is not a problem: modules that answered already do not answer again', async () => {
      const view = await requestExport()
      await deliverAll()
      const before = eventsOf('identity.data_exported.v1').length
      const [requested] = eventsOf(PrivacyEvents.DataExportRequested)
      // Same message id → the inbox stops the handler.
      const envelope: Envelope = {
        id: 'same',
        type: requested?.type ?? '',
        source: 'privacy',
        aggregateId: USER,
        occurredAt: clock.now().toISOString(),
        payload: { ...requested?.payload, modules: ['profile'] },
        headers: {},
      }
      const handler = handlers.find((h) => h.name === 'identity.export')
      await handler?.handle(envelope)
      expect(eventsOf('identity.data_exported.v1')).toHaveLength(before)
      expect(view.id).toBeTruthy()
    })

    test('a ready export is downloadable by its owner until it expires; then its folder is deleted', async () => {
      const view = await requestExport()
      await deliverAll()
      const download = new GetExportDownload(exports, storage, stepUp(), clock)

      const link = await download.execute({
        userId: USER,
        exportId: view.id,
        authTime: fresh(clock),
      })
      expect(link.url).toContain(exportArchiveKey(USER, view.id))
      expect(link.expiresAt).toBe(new Date(clock.now().getTime() + 15 * MINUTE).toISOString())

      await expect(
        download.execute({ userId: OTHER, exportId: view.id, authTime: fresh(clock) }),
      ).rejects.toMatchObject({ code: 'export_not_found' })
      await expect(
        download.execute({ userId: USER, exportId: view.id, authTime: undefined }),
      ).rejects.toMatchObject({ code: 'step_up_required' })

      clock.advance(7 * DAY)
      expect(await jobs().runOnce()).toMatchObject({ expired: 1 })
      expect(
        [...storage.data.keys()].filter((k) => k.startsWith(exportFolder(USER, view.id))),
      ).toEqual([])
      await expect(
        download.execute({ userId: USER, exportId: view.id, authTime: fresh(clock) }),
      ).rejects.toMatchObject({ code: 'export_not_ready' })
    })

    test('an export that is not ready has no download', async () => {
      const view = await requestExport()
      await expect(
        new GetExportDownload(exports, storage, stepUp(), clock).execute({
          userId: USER,
          exportId: view.id,
          authTime: fresh(clock),
        }),
      ).rejects.toMatchObject({ code: 'export_not_ready' })
    })
  })

  describe('account deletion', () => {
    test('is only scheduled: nothing is asked of any module until the grace period ends', async () => {
      const view = await scheduleDeletion()
      expect(view.status).toBe('scheduled')
      expect(view.scheduledFor).toBe(new Date(clock.now().getTime() + 14 * DAY).toISOString())
      const [scheduled] = eventsOf(PrivacyEvents.AccountDeletionScheduled)
      expect(scheduled?.payload).toMatchObject({ userId: USER, email: `${USER}@x.co` })

      clock.advance(14 * DAY - 1)
      expect(await jobs().runOnce()).toMatchObject({ started: 0 })
      expect(eventsOf(PrivacyEvents.AccountErasureRequested)).toHaveLength(0)
    })

    test('needs a recent confirmation, and only one at a time', async () => {
      await expect(scheduleDeletion(USER, 'none')).rejects.toMatchObject({
        code: 'step_up_required',
      })
      await scheduleDeletion()
      await expect(scheduleDeletion()).rejects.toMatchObject({ code: 'deletion_already_scheduled' })
    })

    test('can be cancelled during the grace period — and then never starts', async () => {
      await scheduleDeletion()
      await cancelDeletion()
      expect(eventsOf(PrivacyEvents.AccountDeletionCancelled)).toHaveLength(1)
      expect(await new GetAccountDeletion(deletions).execute({ userId: USER })).toBeNull()

      clock.advance(30 * DAY)
      expect(await jobs().runOnce()).toMatchObject({ started: 0 })
      // …and the user can schedule again.
      await expect(scheduleDeletion(USER, fresh(clock))).resolves.toMatchObject({
        status: 'scheduled',
      })
    })

    test('can not be cancelled when nothing is scheduled, or once the erasure has started', async () => {
      await expect(cancelDeletion()).rejects.toMatchObject({ code: 'no_deletion_scheduled' })
      await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      await expect(cancelDeletion()).rejects.toMatchObject({ code: 'deletion_in_progress' })
    })

    test('every module — including one that lives in another service — erases and confirms; only then is the account deleted', async () => {
      const view = await scheduleDeletion()
      clock.advance(14 * DAY)
      expect(await jobs().runOnce()).toMatchObject({ started: 1 })
      const [asked] = eventsOf(PrivacyEvents.AccountErasureRequested)
      expect(asked?.payload).toMatchObject({
        deletionId: view.id,
        modules: ['identity', 'profile', 'privacy', 'ledger'],
        attempt: 0,
      })

      ledgerAnswers = false
      await deliverAll()
      expect(erased.sort()).toEqual([`identity:${USER}`, `privacy:${USER}`, `profile:${USER}`])
      // Three of four: not deleted yet — the outside module has not said anything.
      expect(eventsOf(PrivacyEvents.AccountDeleted)).toHaveLength(0)
      const progress = await new GetAccountDeletion(deletions).execute({ userId: USER })
      expect(progress).toMatchObject({ status: 'running', progress: { done: 3, total: 4 } })

      // The service comes back and answers (on a re-sent request).
      ledgerAnswers = true
      clock.advance(10 * MINUTE)
      await jobs().runOnce()
      await deliverAll()

      expect(eventsOf(PrivacyEvents.AccountDeleted)).toHaveLength(1)
      expect(eventsOf(PrivacyEvents.AccountDeleted)[0]?.payload).toMatchObject({
        userId: USER,
        email: `${USER}@x.co`,
      })
      expect(eventsOf(PrivacyEvents.AccountErasureProgressed).map((e) => e.payload.done)).toEqual([
        1, 2, 3, 4,
      ])
      const stored = await deletions.findById(view.id)
      expect(stored?.status).toBe('completed')
      expect(stored?.email).toBeNull()
      expect(await new GetAccountDeletion(deletions).execute({ userId: USER })).toBeNull()
    })

    test('a module that fails is retried; the others are not asked again, and the rest of the job waits for it', async () => {
      await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      failures.profile = 2

      await deliverAll()
      expect(failed.map((f) => f.handler.name)).toEqual(['profile.erase'])
      expect(eventsOf(PrivacyEvents.AccountDeleted)).toHaveLength(0)

      await retryFailed() // second failure
      expect(failed).toHaveLength(1)
      await retryFailed() // success
      expect(failed).toHaveLength(0)
      expect(eventsOf(PrivacyEvents.AccountDeleted)).toHaveLength(1)
      // Each module erased exactly once despite the retries.
      expect(erased.filter((e) => e.startsWith('identity:'))).toHaveLength(1)
    })

    test('a module that is silent gets the request again — only it; after too many tries the job stalls, and a late answer still finishes it', async () => {
      const view = await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      ledgerAnswers = false
      await deliverAll()

      clock.advance(10 * MINUTE)
      expect(await jobs().runOnce()).toMatchObject({ nudged: 1 })
      let requests = eventsOf(PrivacyEvents.AccountErasureRequested)
      expect(requests[1]?.payload).toMatchObject({ modules: ['ledger'], attempt: 1 })
      await deliverAll()
      // The modules that had confirmed did not erase again.
      expect(erased).toHaveLength(3)

      clock.advance(10 * MINUTE)
      await jobs().runOnce()
      clock.advance(10 * MINUTE)
      expect(await jobs().runOnce()).toMatchObject({ stalled: 1 })
      expect((await deletions.findById(view.id))?.status).toBe('stalled')
      expect(eventsOf(PrivacyEvents.AccountDeletionStalled)[0]?.payload).toMatchObject({
        deletionId: view.id,
        pending: ['ledger'],
      })
      // The user still sees an erasure under way, not an error.
      expect(await new GetAccountDeletion(deletions).execute({ userId: USER })).toMatchObject({
        status: 'running',
      })

      // An operator fixes the service and resumes: one more round, and it completes.
      ledgerAnswers = true
      await new ResumeStalledDeletion(
        deletions,
        new PassthroughUnitOfWork(),
        outbox,
        clock,
      ).execute({
        deletionId: view.id,
      })
      await deliverAll()
      expect((await deletions.findById(view.id))?.status).toBe('completed')
      requests = eventsOf(PrivacyEvents.AccountErasureRequested)
      expect(requests.at(-1)?.payload.modules).toEqual(['ledger'])
    })

    test('a stalled job whose module finally answers on its own completes too', async () => {
      const view = await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      ledgerAnswers = false
      await deliverAll()
      for (let i = 0; i < 3; i++) {
        clock.advance(10 * MINUTE)
        await jobs().runOnce()
      }
      expect((await deletions.findById(view.id))?.status).toBe('stalled')

      await outbox.add([
        {
          type: participantEvents('ledger').userDataErased,
          aggregateId: USER,
          payload: { deletionId: view.id, userId: USER, module: 'ledger', erasedAt: 'x' },
          occurredAt: clock.now(),
        },
      ])
      await deliverAll()
      expect((await deletions.findById(view.id))?.status).toBe('completed')
    })

    test('confirmations for another user or an unknown deletion change nothing', async () => {
      const view = await scheduleDeletion()
      clock.advance(14 * DAY)
      await jobs().runOnce()
      handlers = handlers.filter((h) => h.name.startsWith('privacy.record-erasure'))
      for (const payload of [
        { deletionId: view.id, userId: OTHER, module: 'identity' },
        { deletionId: 'nope', userId: USER, module: 'identity' },
      ])
        await outbox.add([
          {
            type: participantEvents('identity').userDataErased,
            aggregateId: USER,
            payload: { ...payload, erasedAt: 'x' },
            occurredAt: clock.now(),
          },
        ])
      await deliverAll()
      expect((await deletions.findById(view.id))?.progress()).toEqual({ done: 0, total: 4 })
    })
  })
})
