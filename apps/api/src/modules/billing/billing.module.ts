import { TOPUP_CURRENCIES } from '@app/shared-types/billing'
import type { TokenVerifier } from '@kit/auth'
import type { Clock, IdGenerator, Log } from '@kit/core'
import type { Database } from '@kit/db'
import type { IntegrationEventHandler, OutboxSource } from '@kit/messaging'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@kit/messaging'
import type { ObjectStorage } from '@kit/storage'
import type { IdentityApi } from '#/modules/identity/contracts'
import type { ProfileApi } from '#/modules/profile/contracts'
import { privacyParticipation } from '#/shared/privacy-participant'
import type { AppModule } from '#/shared/runtime'
import { intervalJobs, noJobs } from '#/shared/runtime'
import { BillingDataExporter } from './application/billing-data-exporter'
import { CurrencyPolicy, type CurrencyRule } from './application/currency-policy'
import { DocumentIssuer } from './application/document-issuer'
import type { PaymentGateway } from './application/ports'
import { CreateTopUp } from './application/use-cases/create-top-up'
import { HandlePaymentEvent } from './application/use-cases/handle-payment-event'
import { GetTopUp, GetWallet, ListTransactions } from './application/use-cases/read-billing'
import { GetDocument, ListDocuments } from './application/use-cases/read-documents'
import { type ReconcilePolicy, ReconcileTopUps } from './application/use-cases/reconcile-top-ups'
import type { BillingConfig } from './config'
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
  config: BillingConfig
  /** Omit to run without payments: balances and history still read, but nobody can top up. */
  payments?: { gateway: PaymentGateway; publishableKey: string }
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

  const { config } = deps
  const seller: Party = {
    name: config.SELLER_NAME,
    email: config.SELLER_EMAIL ?? null,
    address: config.SELLER_ADDRESS ?? null,
    taxId: config.SELLER_TAX_ID ?? null,
  }
  const rules: CurrencyRule[] = config.TOPUP_CURRENCIES.map((code) => ({
    code,
    ...TOPUP_CURRENCIES[code],
  }))
  const reconcile: ReconcilePolicy = {
    settleGraceMs: config.BILLING_SETTLE_GRACE * 1000,
    giveUpAfterMs: config.BILLING_RECONCILE_MAX_AGE * 1000,
    batchSize: 50,
  }
  const currencies = new CurrencyPolicy(rules)
  const topUps = new DrizzleTopUpRepository(database)
  const ledger = new DrizzleLedgerRepository(database)
  const documents = new DrizzleDocumentRepository(database)
  const issuer = new DocumentIssuer(
    documents,
    seller,
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
    ? new ReconcileTopUps(topUps, payments.gateway, handlePaymentEvent, reconcile, clock, log)
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
        intervalMs: config.BILLING_RECONCILE_INTERVAL_SECONDS * 1000,
        run: () => reconciler.runOnce(),
        onError: (err) => log.error({ err }, 'top-up reconciliation failed'),
      })
    : noJobs

  return {
    name: 'billing',
    docs: [
      {
        name: 'billing',
        description:
          'Top up a wallet with Stripe (one balance per currency) and read the transaction history. The wallet is credited by the Stripe webhook.',
      },
    ],
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
