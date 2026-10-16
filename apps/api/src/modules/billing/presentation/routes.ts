import { Elysia, t } from 'elysia'
import { NotFoundError, ValidationError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { errorResponse, validationError } from '#/shared/http/openapi'
import type { CurrencyPolicy } from '../application/currency-policy'
import { InvalidWebhookError, type PaymentGateway } from '../application/ports'
import type { CreateTopUp } from '../application/use-cases/create-top-up'
import type { HandlePaymentEvent } from '../application/use-cases/handle-payment-event'
import {
  DEFAULT_PAGE_SIZE,
  type GetTopUp,
  type GetWallet,
  type ListTransactions,
  MAX_PAGE_SIZE,
} from '../application/use-cases/read-billing'

export interface BillingRouteDeps {
  verifier: TokenVerifier
  currencies: CurrencyPolicy
  /** Absent = payments are not configured on this deployment: reading still works, topping up does not. */
  payments?: { gateway: PaymentGateway; publishableKey: string }
  useCases: {
    createTopUp: CreateTopUp
    getTopUp: GetTopUp
    getWallet: GetWallet
    listTransactions: ListTransactions
    handlePaymentEvent: HandlePaymentEvent
  }
}

const money = {
  currency: t.String({ description: 'ISO 4217 code, lower case', examples: ['usd'] }),
  amount: t.Integer({
    minimum: 1,
    description: "In the currency's smallest unit: cents for `usd`, whole dong for `vnd`",
  }),
}

const transactionBody = t.Object({
  id: t.String({ format: 'uuid' }),
  type: t.Literal('topup'),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('succeeded'),
    t.Literal('failed'),
    t.Literal('canceled'),
  ]),
  ...money,
  failureReason: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
})

const NOT_AVAILABLE = ['billing_disabled'] as const

export const billingRoutes = ({
  verifier,
  currencies,
  payments,
  useCases: uc,
}: BillingRouteDeps) => {
  return new Elysia({ prefix: '/billing', tags: ['billing'] })
    .use(authPlugin(verifier))
    .get(
      '/config',
      () => ({
        enabled: payments !== undefined,
        publishableKey: payments?.publishableKey ?? null,
        currencies: currencies.all().map((c) => ({ ...c, presets: [...c.presets] })),
      }),
      {
        auth: true,
        detail: {
          summary: 'What the top-up form needs',
          description:
            'Whether top-ups are on, the Stripe publishable key the browser needs, and the currencies with their range and suggested amounts.',
        },
        response: {
          200: t.Object({
            enabled: t.Boolean(),
            publishableKey: t.Nullable(t.String()),
            currencies: t.Array(
              t.Object({
                code: t.String(),
                min: t.Integer(),
                max: t.Integer(),
                presets: t.Array(t.Integer()),
              }),
            ),
          }),
        },
      },
    )
    .post(
      '/topups',
      ({ auth, body }) =>
        uc.createTopUp.execute({
          userId: auth.userId,
          currency: body.currency,
          amount: body.amount,
        }),
      {
        auth: true,
        body: t.Object(money),
        detail: {
          summary: 'Start a top-up',
          description:
            'Creates a payment with Stripe. The browser completes it with the returned `clientSecret` (Payment Element); the wallet is credited when Stripe confirms, not when this returns.',
        },
        response: {
          200: t.Object({
            topUpId: t.String({ format: 'uuid' }),
            clientSecret: t.String(),
          }),
          400: validationError('unsupported_currency', 'amount_out_of_range'),
          404: errorResponse(404, ...NOT_AVAILABLE),
        },
      },
    )
    .get(
      '/topups/:id',
      ({ auth, params }) => uc.getTopUp.execute({ userId: auth.userId, topUpId: params.id }),
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Look at a top-up',
          description:
            'Where a top-up stands; the page Stripe returns to polls this until it settles.',
        },
        response: {
          200: transactionBody,
          404: errorResponse(404, 'topup_not_found'),
        },
      },
    )
    .get('/wallet', ({ auth }) => uc.getWallet.execute({ userId: auth.userId }), {
      auth: true,
      detail: {
        summary: 'My balances',
        description: 'One balance per currency that was ever topped up.',
      },
      response: {
        200: t.Object({
          balances: t.Array(t.Object({ currency: t.String(), amount: t.Integer() })),
        }),
      },
    })
    .get(
      '/transactions',
      ({ auth, query }) =>
        uc.listTransactions.execute({
          userId: auth.userId,
          before: query.before,
          limit: query.limit,
        }),
      {
        auth: true,
        query: t.Object({
          limit: t.Optional(
            t.Integer({
              minimum: 1,
              maximum: MAX_PAGE_SIZE,
              default: DEFAULT_PAGE_SIZE,
              description: 'Page size',
            }),
          ),
          before: t.Optional(
            t.String({
              format: 'uuid',
              description: '`nextCursor` of the previous page, to fetch older transactions',
            }),
          ),
        }),
        detail: {
          summary: 'My transactions',
          description:
            'Newest first, paginated with a cursor. Includes top-ups that are pending or were declined.',
        },
        response: {
          200: t.Object({
            items: t.Array(transactionBody),
            nextCursor: t.Nullable(t.String({ format: 'uuid' })),
          }),
          400: validationError(),
        },
      },
    )
    .post(
      '/webhooks/stripe',
      async ({ body, request }) => {
        if (!payments) throw new NotFoundError('billing_disabled', 'Top-ups are not available')
        let event: Awaited<ReturnType<PaymentGateway['parseWebhook']>>
        try {
          event = await payments.gateway.parseWebhook(body, request.headers.get('stripe-signature'))
        } catch (err) {
          if (err instanceof InvalidWebhookError)
            throw new ValidationError('invalid_signature', 'Invalid webhook signature')
          throw err
        }
        if (event) await uc.handlePaymentEvent.execute(event)
        return { received: true as const }
      },
      {
        // The signature is computed over the exact bytes Stripe sent, so the body must reach us unparsed. No `auth`:
        // the signature is what proves the caller.
        parse: 'text',
        body: t.String(),
        detail: {
          summary: 'Stripe webhook',
          description:
            'Called by Stripe, not by the web app. Verified with the `Stripe-Signature` header; settles top-ups.',
        },
        response: {
          200: t.Object({ received: t.Literal(true) }),
          400: errorResponse(400, 'invalid_signature'),
          404: errorResponse(404, ...NOT_AVAILABLE),
        },
      },
    )
}
