import { expect, test } from '@playwright/test'
import { countMails, linkFromMail, TEST_IP } from './support'

const uniqueEmail = (tag: string) => `pw-${tag}-${Date.now()}@example.test`

test.describe('notifications', () => {
  test('a new account is welcomed, the badge clears when all are read, and it syncs across tabs', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: 'http://localhost:5173',
      extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
    })
    await context.grantPermissions(['notifications'], { origin: 'http://localhost:5173' })
    const email = uniqueEmail('notif')
    const page = await context.newPage()
    await page.goto('/login')
    const before = await countMails(email, 'sign-in')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await page.goto(await linkFromMail(email, 'sign-in', before))
    await expect(page.getByTestId('account-email')).toHaveText(email)

    // The welcome notification is created asynchronously and pushed live: the badge shows up without a reload.
    await expect(page.getByTestId('unread-badge')).toHaveText('1')

    // A second tab on the same account.
    const other = await context.newPage()
    await other.goto('/notifications')
    await expect(other.getByTestId('notifications').getByRole('listitem')).toHaveCount(1)
    await expect(other.getByText('Welcome aboard')).toBeVisible()
    // Web Push is configured (VAPID keys in .env) and Chromium supports it: the opt-in is offered, not forced.
    await expect(other.getByTestId('push-toggle')).toHaveText(/Turn on/)

    await other.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(other.getByTestId('unread-badge')).toHaveCount(0)
    // The first tab hears about it through the stream.
    await expect(page.getByTestId('unread-badge')).toHaveCount(0)
    await expect(other.locator('[data-read="false"]')).toHaveCount(0)
    await context.close()
  })
})
