import {
  type AccountErasureRequestedPayload,
  type DataExportRequestedPayload,
  PrivacyEvents,
} from '#/modules/privacy/contracts'
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
import type { PaymentGateway } from './application/ports'
import { CreateTopUp } from './application/use-cases/create-top-up'
import { HandlePaymentEvent } from './application/use-cases/handle-payment-event'
import { GetTopUp, GetWallet, ListTransactions } from './application/use-cases/read-billing'
import { BillingEvents } from './contracts/events'
import {
  DrizzleLedgerRepository,
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
  /** Currencies a wallet can be topped up in. */
  currencies: readonly CurrencyRule[]
  /** Omit to run without payments: balances and history still read, but nobody can top up. */
  payments?: { gateway: PaymentGateway; publishableKey: string }
}

export interface BillingModule {
  name: 'billing'
  routes: ReturnType<typeof billingRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

export function createBillingModule(deps: BillingModuleDeps): BillingModule {
  const { database, clock, ids, log, storage, verifier, payments } = deps

  const currencies = new CurrencyPolicy(deps.currencies)
  const topUps = new DrizzleTopUpRepository(database)
  const ledger = new DrizzleLedgerRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)

  return {
    name: 'billing',
    routes: billingRoutes({
      verifier,
      currencies,
      payments,
      useCases: {
        createTopUp: new CreateTopUp(currencies, payments?.gateway, topUps, ids, clock),
        getTopUp: new GetTopUp(topUps),
        getWallet: new GetWallet(ledger),
        listTransactions: new ListTransactions(topUps),
        handlePaymentEvent: new HandlePaymentEvent(
          topUps,
          ledger,
          outboxWriter,
          database,
          ids,
          clock,
          log,
        ),
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
        new BillingDataExporter(topUps, ledger),
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
  }
}
