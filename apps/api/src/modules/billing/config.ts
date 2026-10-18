import { TOPUP_CURRENCY_CODES } from '@app/shared-types'
import { z } from 'zod'
import { allOrNone, blank, defineSlice, duration, list, posInt } from '#/shared/config'

export const billingConfig = defineSlice({
  title: 'Billing: top-ups with Stripe',
  notes: [
    'Leave the three Stripe values unset to turn top-ups off (balances and history still work).',
    '1. Take the test keys from https://dashboard.stripe.com/test/apikeys',
    '2. `bun run stripe:secret` prints the webhook signing secret the Stripe CLI uses locally',
    '3. `bun run dev` then forwards Stripe webhooks to the API (needs the `stripe` CLI or docker)',
    'In production create a webhook endpoint for `<API>/api/billing/webhooks/stripe` with the events payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, refund.created, refund.updated, charge.dispute.created, charge.dispute.updated and charge.dispute.closed, and use its secret.',
  ].join('\n'),
  schema: z
    .object({
      STRIPE_SECRET_KEY: blank.describe('Stripe secret key (`sk_test_…`).'),
      STRIPE_PUBLISHABLE_KEY: blank.describe('Stripe publishable key (`pk_test_…`).'),
      STRIPE_WEBHOOK_SECRET: blank.describe('Signing secret of the webhook endpoint (`whsec_…`).'),
      BILLING_RECONCILE_INTERVAL_SECONDS: posInt(300).describe(
        'How often payments whose webhook has not come are checked against Stripe.',
      ),
      BILLING_SETTLE_GRACE: duration('15m').describe(
        'An open payment is left to its webhook this long; after that Stripe is asked, and again every this long.',
      ),
      BILLING_RECONCILE_MAX_AGE: duration('3d').describe(
        'Payments older than this that never completed are no longer checked.',
      ),
      SELLER_NAME: z
        .string()
        .min(1)
        .default('Elysia Architecture')
        .describe(
          'Who issues the invoices, receipts and credit notes; written onto each document when it is issued.',
        ),
      SELLER_ADDRESS: blank.describe('Seller address.'),
      SELLER_TAX_ID: blank.describe('VAT number, MST or the like.'),
      SELLER_EMAIL: blank.describe('Seller contact email.'),
      TOPUP_CURRENCIES: list(TOPUP_CURRENCY_CODES, TOPUP_CURRENCY_CODES.join(',')).describe(
        'Currencies a wallet can be topped up in, comma separated (the ranges are in `packages/shared-types/src/billing.ts`).',
      ),
    })
    .superRefine((env, ctx) => {
      allOrNone(ctx, {
        STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
        STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY,
        STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
      })
    }),
})

export type BillingConfig = z.infer<typeof billingConfig.schema>
