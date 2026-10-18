import type { IdentityApi } from '#/modules/identity/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  ObjectStorage,
} from '#/shared/application/ports'
import { EraseUserDataHandler } from '#/shared/application/privacy'
import type { StepUpPolicy } from '#/shared/application/step-up-policy'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import type { AppModule } from '#/shared/module/app-module'
import { intervalJobs } from '#/shared/module/interval-jobs'
import { AssembleExport } from './application/handlers/assemble-export'
import { RecordErasure } from './application/handlers/record-erasure'
import { RecordExportPart } from './application/handlers/record-export-part'
import type { PrivacyPolicy } from './application/ports'
import { type JobsReport, PrivacyJobs } from './application/privacy-jobs'
import {
  CancelAccountDeletion,
  GetAccountDeletion,
  ResumeStalledDeletion,
  ScheduleAccountDeletion,
} from './application/use-cases/account-deletion'
import {
  GetDataExport,
  GetExportDownload,
  ListDataExports,
  RequestDataExport,
} from './application/use-cases/data-export'
import {
  type AccountErasureRequestedPayload,
  PrivacyEvents,
  participantEvents,
} from './contracts/events'
import { DrizzleAccountDeletionRepository } from './infrastructure/persistence/drizzle-deletion-repository'
import { DrizzleDataExportRepository } from './infrastructure/persistence/drizzle-export-repository'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { PrivacyDataEraser } from './infrastructure/privacy-data-eraser'
import { ZipArchiveBuilder } from './infrastructure/zip-archive-builder'
import { privacyRoutes } from './presentation/routes'

export interface PrivacyModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  storage: ObjectStorage
  log: Log
  /** Depends only on identity's CONTRACT: privacy needs the address to mail the export link and to say goodbye. */
  identity: IdentityApi
  verifier: TokenVerifier
  stepUp: StepUpPolicy
  policy: PrivacyPolicy
  /** How often the time-driven part of the jobs looks for work. */
  jobsIntervalMs: number
}

export interface PrivacyModule extends AppModule<'privacy', ReturnType<typeof privacyRoutes>> {
  routes: ReturnType<typeof privacyRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  /** One pass over everything that is due. Runs on a timer (`jobs`); exposed for tests and operators. */
  runJobs(): Promise<JobsReport>
  /** Operator: gives a stalled deletion another round (after fixing why a module did not answer). */
  resumeDeletion(deletionId: string): Promise<void>
}

export function createPrivacyModule(deps: PrivacyModuleDeps): PrivacyModule {
  const { database, clock, ids, storage, log, identity, verifier, stepUp, policy } = deps

  const exports = new DrizzleDataExportRepository(database)
  const deletions = new DrizzleAccountDeletionRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)
  const privacyJobs = new PrivacyJobs(
    exports,
    deletions,
    storage,
    policy,
    outboxWriter,
    database,
    clock,
    log,
  )
  const resume = new ResumeStalledDeletion(deletions, database, outboxWriter, clock)

  // Row claims keep two instances that tick together apart.
  const jobs = intervalJobs({
    intervalMs: deps.jobsIntervalMs,
    run: () => privacyJobs.runOnce(),
    onError: (err) => log.error({ err }, 'privacy jobs failed'),
  })

  return {
    name: 'privacy',
    routes: privacyRoutes({
      verifier,
      useCases: {
        requestDataExport: new RequestDataExport(
          exports,
          deletions,
          identity,
          policy,
          stepUp,
          outboxWriter,
          database,
          ids,
          clock,
        ),
        listDataExports: new ListDataExports(exports),
        getDataExport: new GetDataExport(exports),
        getExportDownload: new GetExportDownload(exports, storage, stepUp, clock),
        scheduleAccountDeletion: new ScheduleAccountDeletion(
          deletions,
          identity,
          policy,
          stepUp,
          outboxWriter,
          database,
          ids,
          clock,
        ),
        cancelAccountDeletion: new CancelAccountDeletion(deletions, outboxWriter, database, clock),
        getAccountDeletion: new GetAccountDeletion(deletions),
      },
    }),
    handlers: [
      // One consumer group per participant and direction: a slow or failing module retries on its own.
      ...policy.exportParticipants.map(
        (module) => new RecordExportPart(module, exports, outboxWriter, inboxGuard, clock),
      ),
      new AssembleExport(
        exports,
        identity,
        storage,
        new ZipArchiveBuilder(),
        policy,
        outboxWriter,
        inboxGuard,
        clock,
        log,
      ),
      ...policy.deletionParticipants.map(
        (module) => new RecordErasure(module, deletions, outboxWriter, inboxGuard, clock),
      ),
      // Privacy erases its own leftovers like any other participant.
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: 'privacy.erase-user-data',
          module: 'privacy',
          requestType: PrivacyEvents.AccountErasureRequested,
          answerType: participantEvents('privacy').userDataErased,
        },
        new PrivacyDataEraser(database, storage),
        outboxWriter,
        inboxGuard,
        clock,
      ),
    ],
    outbox: { name: 'privacy', table: outbox },
    jobs,
    runJobs: () => privacyJobs.runOnce(),
    resumeDeletion: (deletionId) => resume.execute({ deletionId }),
  }
}
