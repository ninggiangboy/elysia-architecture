import type { IdentityApi } from '#/modules/identity/contracts'
import {
  type AccountErasureRequestedPayload,
  type DataExportRequestedPayload,
  PrivacyEvents,
} from '#/modules/privacy/contracts'
import type { ProfileApi } from '#/modules/profile/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  ObjectStorage,
} from '#/shared/application/ports'
import { EraseUserDataHandler, ExportUserDataHandler } from '#/shared/application/privacy'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
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

export interface BillingModule {
  name: 'billing'
  routes: ReturnType<typeof billingRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  /** One reconciliation pass (the timer calls this; tests and operators can too). */
  reconcile: () => Promise<number>
  startJobs: () => void
  stopJobs: () => Promise<void>
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

  let timer: ReturnType<typeof setInterval> | undefined
  let running: Promise<unknown> | undefined
  const tick = () => {
    // A slow pass is not overlapped by the next one; two instances may still tick together, the row claims keep them apart.
    running ??= reconciler
      ?.runOnce()
      .catch((err) => log.error({ err }, 'top-up reconciliation failed'))
      .finally(() => {
        running = undefined
      })
  }

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
    handlers: [
      new ExportUserDataHandler<DataExportRequestedPayload>(
        {
          name: 'billing.export-user-data',
          module: 'billing',
          requestType: PrivacyEvents.DataExportRequested,
          answerType: BillingEvents.DataExported,
        },
        new BillingDataExporter(topUps, ledger, documents),
        storage,
        outboxWriter,
        inboxGuard,
        clock,
      ),
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: 'billing.erase-user-data',
          module: 'billing',
          requestType: PrivacyEvents.AccountErasureRequested,
          answerType: BillingEvents.UserDataErased,
        },
        new DrizzleBillingDataEraser(database),
        outboxWriter,
        inboxGuard,
        clock,
      ),
    ],
    outbox: { name: 'billing', table: outbox },
    reconcile: async () => reconciler?.runOnce() ?? 0,
    startJobs() {
      if (timer || !reconciler) return
      timer = setInterval(tick, deps.reconcileIntervalMs)
      timer.unref()
    },
    async stopJobs() {
      if (timer) clearInterval(timer)
      timer = undefined
      await running
    },
  }
}
