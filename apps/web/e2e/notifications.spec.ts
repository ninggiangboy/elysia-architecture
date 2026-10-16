import { expect, type Page, test } from '@playwright/test'
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

  test('a new notification appears in an open popover without reopening it, and reads sync live', async ({
    browser,
  }) => {
    const options = {
      baseURL: 'http://localhost:5173',
      extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
    }
    const signIn = async (page: Page, email: string) => {
      await page.goto('/login')
      const before = await countMails(email, 'sign-in')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send sign-in link' }).click()
      await page.goto(await linkFromMail(email, 'sign-in', before))
      await expect(page.getByTestId('account-email')).toHaveText(email)
    }
    const email = uniqueEmail('live-list')
    const here = await browser.newContext(options)
    const page = await here.newPage()
    await signIn(page, email)
    await page.getByRole('button', { name: /^Notifications/ }).click()
    const items = page.getByTestId('notifications').getByRole('listitem')
    await expect(items).toHaveCount(1)

    // Another device signs in: its "new sign-in" notification shows up in the list that is already open.
    const there = await browser.newContext(options)
    await signIn(await there.newPage(), email)
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText(/sign-in/i)
    // The popover is open, so it counts as seen.
    await expect(page.getByTestId('unseen-badge')).toHaveCount(0)

    // Reading on the other device flips the item here without a reload.
    await there
      .pages()[0]
      ?.getByRole('button', { name: /^Notifications/ })
      .click()
    await there.pages()[0]?.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(page.locator('[data-read="false"]')).toHaveCount(0)
    await here.close()
    await there.close()
  })

  test('marking read is optimistic: it shows before the server answers and is undone if the request fails', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: 'http://localhost:5173',
      extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
    })
    const email = uniqueEmail('optimistic')
    const page = await context.newPage()
    await page.goto('/login')
    const before = await countMails(email, 'sign-in')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await page.goto(await linkFromMail(email, 'sign-in', before))
    await expect(page.getByTestId('unseen-badge')).toHaveText('1')
    await page.getByRole('button', { name: /^Notifications/ }).click()
    const unread = page.locator('[data-read="false"]')
    await expect(unread).toHaveCount(1)

    // The server fails: the item flips to read at once, then comes back as unread with an error toast.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/notifications/read-all', async (route) => {
      await gate
      await route.fulfill({ status: 500, json: { error: { code: 'boom', message: 'Boom' } } })
    })
    await page.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(unread).toHaveCount(0)
    release()
    await expect(unread).toHaveCount(1)
    await expect(page.getByText('Boom')).toBeVisible()

    // And when the server is fine, it sticks.
    await page.unroute('**/api/notifications/read-all')
    await page.getByRole('button', { name: 'Mark read' }).click()
    await expect(unread).toHaveCount(0)
    await page.reload()
    await page.getByRole('button', { name: /^Notifications/ }).click()
    await expect(page.getByTestId('notifications').getByRole('listitem')).toHaveCount(1)
    await expect(unread).toHaveCount(0)
    await context.close()
  })
})
