import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { countMails, linkFromMail, TEST_IP } from './support'

const uniqueEmail = (tag: string) => `pw-${tag}-${Date.now()}@example.test`

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto('/login')
  const before = await countMails(email, 'sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()
  await page.goto(await linkFromMail(email, 'sign-in', before))
  await expect(page.getByTestId('account-email')).toHaveText(email)
  return page
}

const newContext = (browser: import('@playwright/test').Browser) =>
  browser.newContext({
    baseURL: 'http://localhost:5173',
    extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
  })

test.describe('realtime', () => {
  test('the SSE stream connects and receives a test event', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await signIn(context, uniqueEmail('rt'))
    await page.getByRole('link', { name: 'Realtime' }).click()

    await expect(page.getByTestId('status-sse')).toHaveText('open')

    await page.getByLabel('Test message').fill('ping from playwright')
    await page.getByRole('button', { name: 'Send test event' }).click()
    await expect(page.getByTestId('log-sse')).toContainText('realtime.test')
    await expect(page.getByTestId('log-sse')).toContainText('ping from playwright')

    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page.getByTestId('status-sse')).toHaveText('closed')
    await context.close()
  })

  test('signing a device out remotely signs it out right away, and the other device sees the change live', async ({
    browser,
  }) => {
    const laptopContext = await newContext(browser)
    const phoneContext = await newContext(browser)
    const email = uniqueEmail('devices')
    const laptop = await signIn(laptopContext, email)
    await laptop.goto('/settings/security')
    await expect(laptop.getByTestId('sessions').getByRole('listitem')).toHaveCount(1)

    const phone = await signIn(phoneContext, email)
    // A new sign-in is not pushed; the laptop sees the phone after a reload.
    await laptop.reload()
    await expect(laptop.getByTestId('sessions').getByRole('listitem')).toHaveCount(2)

    await laptop
      .getByTestId('sessions')
      .getByRole('listitem')
      .filter({ hasNot: laptop.getByText('This device') })
      .getByRole('button', { name: 'Sign out' })
      .click()

    // The phone is pushed to the login page immediately (not after the 15-minute access token).
    await expect(phone).toHaveURL(/\/login$/)
    await expect(laptop.getByTestId('sessions').getByRole('listitem')).toHaveCount(1)
    await laptopContext.close()
    await phoneContext.close()
  })
})
