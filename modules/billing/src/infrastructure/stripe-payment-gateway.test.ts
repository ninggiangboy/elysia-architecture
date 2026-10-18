import { describe, expect, test } from 'bun:test'
import Stripe from 'stripe'
import { InvalidWebhookError } from '../application/ports'
import { StripePaymentGateway } from './stripe-payment-gateway'

// The real signature scheme and the real parsing, with no network: Stripe's own helper signs the payload.
const SECRET = 'whsec_test_secret'
const gateway = new StripePaymentGateway('sk_test_unused', SECRET)
const signer = new Stripe('sk_test_unused', { httpClient: Stripe.createFetchHttpClient() })

const deliver = async (type: string, object: Record<string, unknown>, id = 'evt_1') => {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } })
  const signature = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET })
  return gateway.parseWebhook(payload, signature)
}

const intent = (over: Record<string, unknown> = {}) => ({
  id: 'pi_1',
  object: 'payment_intent',
  amount: 2000,
  amount_received: 2000,
  currency: 'usd',
  metadata: { topUpId: 'tu_1', userId: 'u_1' },
  last_payment_error: null,
  ...over,
})

describe('StripePaymentGateway.parseWebhook', () => {
  test('rejects a missing, forged or stale signature', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: {} })
    await expect(gateway.parseWebhook(payload, null)).rejects.toBeInstanceOf(InvalidWebhookError)
    await expect(gateway.parseWebhook(payload, 't=1,v1=abc')).rejects.toBeInstanceOf(
      InvalidWebhookError,
    )
    const stale = await signer.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    })
    await expect(gateway.parseWebhook(payload, stale)).rejects.toBeInstanceOf(InvalidWebhookError)
  })

  test('reads what was actually charged for a success', async () => {
    expect(
      await deliver('payment_intent.succeeded', intent({ amount: 2000, amount_received: 1900 })),
    ).toEqual({
      kind: 'outcome',
      id: 'evt_1',
      outcome: 'succeeded',
      paymentIntentId: 'pi_1',
      topUpId: 'tu_1',
      amount: 1900,
      currency: 'usd',
      failureReason: null,
    })
  })

  test('reads why a payment was declined', async () => {
    const event = await deliver(
      'payment_intent.payment_failed',
      intent({ amount_received: 0, last_payment_error: { message: 'Your card was declined.' } }),
    )
    expect(event).toMatchObject({
      kind: 'outcome',
      outcome: 'failed',
      amount: 2000,
      failureReason: 'Your card was declined.',
    })
  })

  const refund = (over: Record<string, unknown> = {}) => ({
    id: 're_1',
    object: 'refund',
    amount: 500,
    currency: 'usd',
    payment_intent: 'pi_1',
    status: 'succeeded',
    ...over,
  })

  test('books a refund that succeeded, on creation or on update', async () => {
    for (const type of ['refund.created', 'refund.updated']) {
      expect(await deliver(type, refund())).toEqual({
        kind: 'adjustment',
        id: 'evt_1',
        adjustment: 'refund',
        paymentIntentId: 'pi_1',
        reference: 're_1',
        amount: 500,
        currency: 'usd',
      })
    }
  })

  test('does not book a refund that has not moved money, or has no payment', async () => {
    for (const status of ['pending', 'failed', 'canceled', 'requires_action'])
      expect(await deliver('refund.updated', refund({ status }))).toBeNull()
    expect(await deliver('refund.created', refund({ payment_intent: null }))).toBeNull()
  })

  const dispute = (over: Record<string, unknown> = {}) => ({
    id: 'dp_1',
    object: 'dispute',
    amount: 2000,
    currency: 'usd',
    payment_intent: 'pi_1',
    charge: 'ch_1',
    status: 'needs_response',
    ...over,
  })

  test('books the money a dispute takes, and gives it back when the dispute is won', async () => {
    expect(await deliver('charge.dispute.created', dispute())).toMatchObject({
      adjustment: 'chargeback',
      reference: 'dp_1',
      paymentIntentId: 'pi_1',
      amount: 2000,
    })
    expect(await deliver('charge.dispute.closed', dispute({ status: 'won' }))).toMatchObject({
      adjustment: 'chargeback_reversal',
      reference: 'dp_1',
    })
  })

  test('an inquiry takes nothing, and a lost dispute gives nothing back', async () => {
    expect(
      await deliver('charge.dispute.created', dispute({ status: 'warning_needs_response' })),
    ).toBeNull()
    expect(await deliver('charge.dispute.closed', dispute({ status: 'warning_closed' }))).toBeNull()
    expect(await deliver('charge.dispute.closed', dispute({ status: 'lost' }))).toBeNull()
    // Won before we saw it open: there is no opening to book either.
    expect(await deliver('charge.dispute.updated', dispute({ status: 'won' }))).toBeNull()
  })

  test('an inquiry that escalates is booked when it does', async () => {
    expect(
      await deliver('charge.dispute.updated', dispute({ status: 'under_review' })),
    ).toMatchObject({
      adjustment: 'chargeback',
    })
  })

  test('acknowledges events it does not act on', async () => {
    expect(await deliver('customer.created', { id: 'cus_1', object: 'customer' })).toBeNull()
  })
})
