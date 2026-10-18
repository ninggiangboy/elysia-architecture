import { describe, expect, test } from 'bun:test'
import { loadConfig } from '@kit/config'
import { billingConfig } from './config'

const load = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ billing: billingConfig }, env).billing
const stripe = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
}

describe('billing config', () => {
  test('Stripe is off unless its three values are set together', () => {
    expect(load().STRIPE_SECRET_KEY).toBeUndefined()
    expect(() => load({ STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow('must be set together')
    expect(() => load({ ...stripe, STRIPE_WEBHOOK_SECRET: '' })).toThrow('must be set together')
    expect(load(stripe).STRIPE_WEBHOOK_SECRET).toBe('whsec_x')
    expect(
      load({ STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '' }).STRIPE_SECRET_KEY,
    ).toBeUndefined()
  })

  test('currencies default to all known ones and reject an unknown code', () => {
    expect(load().TOPUP_CURRENCIES).toEqual(['usd', 'eur', 'vnd'])
    expect(load({ TOPUP_CURRENCIES: 'vnd, usd' }).TOPUP_CURRENCIES).toEqual(['vnd', 'usd'])
    expect(() => load({ TOPUP_CURRENCIES: 'xyz' })).toThrow('TOPUP_CURRENCIES')
  })

  test('the seller defaults to the app name', () => {
    expect(load().SELLER_NAME).toBe('Elysia Architecture')
  })
})
