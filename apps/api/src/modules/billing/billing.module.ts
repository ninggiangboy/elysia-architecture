import type { IdentityApi } from '#/modules/identity/contracts'
import type { ProfileApi } from '#/modules/profile/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  ObjectStorage,
} from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import type { AppModule } from '#/shared/module/app-module'
import { intervalJobs, noJobs } from '#/shared/module/interval-jobs'
import { privacyParticipation } from '#/shared/privacy-participant'
import { BillingDataExporter } from './application/billing-data-exporter'
import { CurrencyPolicy, type CurrencyRule } from './application/currency-policy'
import { DocumentIssuer } from './application/document-issuer'
import type { PaymentGateway } from './application/ports'
import { CreateTopUp } from './application/use-cases/create-top-up'
import { HandlePaymentEvent } from './application/use-cases/handle-payment-event'
import { GetTopUp, GetWallet, ListTransactions } from './application/use-cases/read-billing'
import { GetDocument, ListDocuments } from './application/use-cases/read-documents'
import { type ReconcilePolicy, ReconcileTopUps } from './application/use-cases/reconcile-top-ups'
import { BillingEvents } from './contracts/events'
import type { Party } from './domain/document'
import { ModuleBuyerDirectory } from './infrastructure/module-buyer-directory'
import {
  DrizzleDocumentRepository,
  DrizzleLedgerRepository,
  DrizzlePaymentAuditRepository,
  DrizzleTopUpRepository,
} from './infrastructure/persistence/drizzle-billing-repositories'
import { DrizzleBillingDataEraser } from './infrastructure/persistence/drizzle-data-eraser'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { billingRoutes } from './presentation/routes'

export interface BillingModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  log: Log
  storage: ObjectStorage
  verifier: TokenVerifier
  /** Depend only on the CONTRACTS of identity and profile: who is paying, to put on the documents. */
  identity: IdentityApi
  profile: ProfileApi
  /** Who the documents come from. */
  seller: Party
  /** Currencies a wallet can be topped up in. */
  currencies: readonly CurrencyRule[]
  /** Omit to run without payments: balances and history still read, but nobody can top up. */
  payments?: { gateway: PaymentGateway; publishableKey: string }
  /** How often the reconciliation job asks the provider about payments whose webhook has not come. */
  reconcileIntervalMs: number
  reconcile: ReconcilePolicy
}

export interface BillingModule extends AppModule<'billing', ReturnType<typeof billingRoutes>> {
  routes: ReturnType<typeof billingRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  /** One reconciliation pass (the timer calls this; tests and operators can too). */
  reconcile: () => Promise<number>
}

export function createBillingModule(deps: BillingModuleDeps): BillingModule {
  const { database, clock, ids, log, storage, verifier, payments } = deps

  const currencies = new CurrencyPolicy(deps.currencies)
  const topUps = new DrizzleTopUpRepository(database)
  const ledger = new DrizzleLedgerRepository(database)
  const documents = new DrizzleDocumentRepository(database)
  const issuer = new DocumentIssuer(
    documents,
    deps.seller,
    new ModuleBuyerDirectory(deps.identity, deps.profile, log),
    ids,
  )
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)
  const audit = new DrizzlePaymentAuditRepository(database)
  const handlePaymentEvent = new HandlePaymentEvent(
    topUps,
    ledger,
    audit,
    outboxWriter,
    database,
    ids,
    clock,
    log,
    issuer,
  )
  const reconciler = payments
    ? new ReconcileTopUps(topUps, payments.gateway, handlePaymentEvent, deps.reconcile, clock, log)
    : undefined

  const participation = privacyParticipation({
    module: 'billing',
    storage,
    outbox: outboxWriter,
    inbox: inboxGuard,
    clock,
    export: {
      exporter: new BillingDataExporter(topUps, ledger, documents),
      answerType: BillingEvents.DataExported,
    },
    erase: {
      eraser: new DrizzleBillingDataEraser(database),
      answerType: BillingEvents.UserDataErased,
    },
  })

  // Row claims keep two instances that tick together apart.
  const jobs = reconciler
    ? intervalJobs({
        intervalMs: deps.reconcileIntervalMs,
        run: () => reconciler.runOnce(),
        onError: (err) => log.error({ err }, 'top-up reconciliation failed'),
      })
    : noJobs

  return {
    name: 'billing',
    routes: billingRoutes({
      verifier,
      currencies,
      payments,
      useCases: {
        createTopUp: new CreateTopUp(
          currencies,
          payments?.gateway,
          topUps,
          ids,
          clock,
          issuer,
          database,
        ),
        getTopUp: new GetTopUp(topUps),
        getWallet: new GetWallet(ledger),
        listTransactions: new ListTransactions(topUps),
        getDocument: new GetDocument(documents),
        listDocuments: new ListDocuments(documents),
        handlePaymentEvent,
      },
    }),
    handlers: [...participation.handlers],
    privacy: participation.privacy,
    outbox: { name: 'billing', table: outbox },
    jobs,
    reconcile: async () => reconciler?.runOnce() ?? 0,
  }
}
