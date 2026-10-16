import { expect, test } from '@playwright/test'
import { countMails, linkFromMail, TEST_IP } from './support'

const uniqueEmail = (tag: string) => `pw-${tag}-${Date.now()}@example.test`

test.describe('notifications', () => {
  test('a new account is welcomed, opening the bell clears the badge but not the unread state, and it syncs across tabs', async ({
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
    await expect(page.getByTestId('unseen-badge')).toHaveText('1')

    // A second tab on the same account. Opening the bell clears the badge, but the notification stays unread.
    const other = await context.newPage()
    await other.goto('/')
    await expect(other.getByTestId('unseen-badge')).toHaveText('1')
    await other.getByRole('button', { name: /^Notifications/ }).click()
    await expect(other.getByTestId('notifications').getByRole('listitem')).toHaveCount(1)
    await expect(other.getByText('Welcome aboard')).toBeVisible()
    await expect(other.getByTestId('unseen-badge')).toHaveCount(0)
    await expect(other.locator('[data-read="false"]')).toHaveCount(1)
    // The first tab hears about it through the stream and clears its badge too.
    await expect(page.getByTestId('unseen-badge')).toHaveCount(0)

    // Web Push is configured (VAPID keys in .env) and Chromium supports it: the opt-in lives on the settings page.
    await other.getByRole('link', { name: 'Notification settings' }).click()
    await expect(other).toHaveURL(/\/notifications\/settings$/)
    await expect(other.getByTestId('push-toggle')).toHaveText(/Turn on/)

    // Still unread after a reload; marking it read is a separate action.
    await other.goto('/')
    await other.getByRole('button', { name: /^Notifications/ }).click()
    await expect(other.locator('[data-read="false"]')).toHaveCount(1)
    await other.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(other.locator('[data-read="false"]')).toHaveCount(0)
    await context.close()
  })
})
