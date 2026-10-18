import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from '@app/shared-types'
import { Elysia, t } from 'elysia'
import { authPlugin, type TokenVerifier } from '#/shared/auth'
import { ConflictError, NotFoundError, ValidationError } from '#/shared/core'
import { errorResponse, validationError } from '#/shared/http'
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
import type { GetDocument, ListDocuments } from '../application/use-cases/read-documents'

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
    getDocument: GetDocument
    listDocuments: ListDocuments
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

const party = t.Object({
  name: t.Nullable(t.String()),
  email: t.Nullable(t.String()),
  address: t.Nullable(t.String()),
  taxId: t.Nullable(t.String()),
})

const documentBody = t.Object({
  id: t.String({ format: 'uuid' }),
  kind: t.UnionEnum([...DOCUMENT_KINDS]),
  number: t.String({ examples: ['INV-2026-000001'] }),
  status: t.UnionEnum([...DOCUMENT_STATUSES]),
  topUpId: t.String({ format: 'uuid' }),
  invoiceId: t.Nullable(t.String({ format: 'uuid' })),
  currency: t.String(),
  amount: t.Integer(),
  seller: party,
  buyer: party,
  lines: t.Array(
    t.Object({
      description: t.String(),
      quantity: t.Integer(),
      unitAmount: t.Integer(),
      amount: t.Integer(),
    }),
  ),
  issuedAt: t.String({ format: 'date-time' }),
  settledAt: t.Nullable(t.String({ format: 'date-time' })),
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
      ({ auth, body, headers }) =>
        uc.createTopUp.execute({
          userId: auth.userId,
          currency: body.currency,
          amount: body.amount,
          idempotencyKey: headers['idempotency-key'],
          billing: body.billing,
        }),
      {
        auth: true,
        body: t.Object({
          ...money,
          billing: t.Optional(
            t.Object(
              {
                name: t.Optional(
                  t.String({
                    maxLength: 120,
                    description: 'A company to bill instead of the person',
                  }),
                ),
                taxId: t.Optional(
                  t.String({ maxLength: 40, description: 'VAT number, MST or the like' }),
                ),
                address: t.Optional(t.String({ maxLength: 300 })),
              },
              {
                description:
                  'Who the invoice is made out to; the profile name is used when omitted',
              },
            ),
          ),
        }),
        headers: t.Object({
          'idempotency-key': t.Optional(
            t.String({
              minLength: 8,
              maxLength: 64,
              pattern: '^[A-Za-z0-9_-]+$',
              description:
                'A unique value per top-up the user starts (a UUID is fine). Sending the request again with the same key and body returns the first top-up instead of opening a second payment.',
            }),
          ),
        }),
        detail: {
          summary: 'Start a top-up',
          description:
            'Creates a payment with Stripe and issues the invoice for it. The browser completes it with the returned `clientSecret` (Payment Element); the wallet is credited when Stripe confirms, not when this returns. Safe to retry with the same `Idempotency-Key`.',
        },
        response: {
          200: t.Object({
            topUpId: t.String({ format: 'uuid' }),
            clientSecret: t.String(),
          }),
          400: validationError('unsupported_currency', 'amount_out_of_range'),
          404: errorResponse(404, ...NOT_AVAILABLE),
          409: errorResponse(409, 'idempotency_key_reused'),
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
    .get(
      '/documents',
      ({ auth, query }) =>
        uc.listDocuments.execute({
          userId: auth.userId,
          kind: query.kind,
          topUpId: query.topUpId,
          before: query.before,
          limit: query.limit,
        }),
      {
        auth: true,
        query: t.Object({
          // Not `UnionEnum`: it would default to its first member when the query has no `kind`.
          kind: t.Optional(
            t.Union([t.Literal('invoice'), t.Literal('receipt'), t.Literal('credit_note')]),
          ),
          topUpId: t.Optional(
            t.String({ format: 'uuid', description: 'Only the documents of this top-up' }),
          ),
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
              description: '`nextCursor` of the previous page, to fetch older documents',
            }),
          ),
        }),
        detail: {
          summary: 'My invoices, receipts and credit notes',
          description:
            'Newest first, paginated with a cursor. An invoice exists from the moment a top-up starts; its receipt appears when the payment succeeds.',
        },
        response: {
          200: t.Object({
            items: t.Array(documentBody),
            nextCursor: t.Nullable(t.String({ format: 'uuid' })),
          }),
          400: validationError(),
        },
      },
    )
    .get(
      '/documents/:id',
      ({ auth, params }) => uc.getDocument.execute({ userId: auth.userId, documentId: params.id }),
      {
        auth: true,
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Look at an invoice, receipt or credit note',
          description:
            "The document as it was issued: seller, buyer and lines are frozen, only an invoice's or a credit note's status moves.",
        },
        response: {
          200: documentBody,
          404: errorResponse(404, 'document_not_found'),
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
        if (event) {
          const result = await uc.handlePaymentEvent.execute(event)
          // Not an error to fix on our side, just early: a non-2xx makes Stripe deliver it again after a pause.
          if (result === 'deferred')
            throw new ConflictError(
              'payment_not_settled_yet',
              'The payment it refers to is not settled yet',
            )
        }
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
            'Called by Stripe, not by the web app. Verified with the `Stripe-Signature` header; settles top-ups and books refunds and disputes. Answers 409 when an event arrived before the payment it refers to was settled, so Stripe sends it again.',
        },
        response: {
          200: t.Object({ received: t.Literal(true) }),
          400: errorResponse(400, 'invalid_signature'),
          404: errorResponse(404, ...NOT_AVAILABLE),
          409: errorResponse(409, 'payment_not_settled_yet'),
        },
      },
    )
}
