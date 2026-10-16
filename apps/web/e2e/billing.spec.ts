import { type Browser, expect, test } from '@playwright/test'
import { countMails, linkFromMail, uniqueIp } from './support'

const uniqueEmail = (tag: string) => `pw-${tag}-${Date.now()}@example.test`

// The suite runs against an API without Stripe keys (the keys are secrets), so what is covered here is everything
// that does not need a payment: the pages, the empty states, the navigation. Paying is covered by the API's e2e
// (a fake provider) and by `bun run test:stripe` (Stripe's test mode).

/** A new account, signed in through the magic link in Mailpit. */
async function signUp(browser: Browser, tag: string) {
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
    extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() },
  })
  const email = uniqueEmail(tag)
  const page = await context.newPage()
  await page.goto('/login')
  const before = await countMails(email, 'sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await page.goto(await linkFromMail(email, 'sign-in', before))
  await expect(page.getByTestId('account-email')).toHaveText(email)
  return { context, page }
}

// Signs up from an IP of its own: magic-link requests are limited per IP, and the other specs of a run share one.
test('the wallet pages: empty states, navigation, and the page Stripe returns to', async ({
  browser,
}) => {
  const { context, page } = await signUp(browser, 'wallet')
  const nav = page.getByRole('navigation', { name: 'Main' }).first()

  await nav.getByRole('link', { name: 'Top up' }).click()
  await expect(page).toHaveURL(/\/topup$/)
  await expect(page.getByRole('heading', { name: 'Top up', level: 1 })).toBeVisible()
  await expect(page.getByTestId('no-balance')).toBeVisible()
  // Either the form (keys set) or the notice (no keys): never a broken page.
  await expect(
    page.getByTestId('topup-disabled').or(page.getByTestId('currency-usd')),
  ).toBeVisible()

  await nav.getByRole('link', { name: 'Transactions' }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await expect(page.getByTestId('no-transactions')).toBeVisible()
  await expect(page.getByTestId('no-balance')).toBeVisible()

  // Stripe appends its own parameters; ours is the only one the page reads.
  await page.goto(
    '/topup/return?topUp=00000000-0000-7000-8000-000000000000&redirect_status=succeeded',
  )
  await expect(page.getByTestId('return-unknown')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible()
  await page.getByRole('link', { name: 'View transactions' }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await context.close()
})
