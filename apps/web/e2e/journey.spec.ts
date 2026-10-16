import { expect, type Page, test } from '@playwright/test'
import { countMails, linkFromMail, PNG, TEST_IP } from './support'

const email = `pw-${Date.now()}@example.test`
const newEmail = `pw-new-${Date.now()}@example.test`

let page: Page

test.describe
  .serial('user journey in the browser', () => {
    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5173',
        extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
      })
      page = await context.newPage()
    })
    test.afterAll(async () => page.context().close())

    test('unauthenticated visitors are sent to /login', async () => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/login$/)
    })

    test('sign in with a magic link', async () => {
      await page.goto('/login')
      const before = await countMails(email, 'sign-in')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send sign-in link' }).click()
      await expect(page.getByText('Check your inbox')).toBeVisible()

      await page.goto(await linkFromMail(email, 'sign-in', before))
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('account-email')).toHaveText(email)
      await expect(page.getByTestId('display-name')).toHaveText(email.split('@')[0]!)
    })

    test('an already used or bogus link shows an error instead of signing in', async ({
      browser,
    }) => {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5173',
        extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
      })
      const anon = await context.newPage()
      await anon.goto('/auth/callback?token=not-a-real-token')
      await expect(anon.getByText('Could not sign in')).toBeVisible()
      await expect(anon.getByText('invalid or has expired')).toBeVisible()
      await context.close()
    })

    test('edit the profile; it survives a reload because the refresh cookie restores the session', async () => {
      await page.getByLabel('Display name').fill('Playwright Tester')
      await page.getByLabel('Bio').fill('Hello from the browser')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Changes saved')).toBeVisible()
      await expect(page.getByTestId('display-name')).toHaveText('Playwright Tester')

      await page.reload()
      await expect(page.getByTestId('display-name')).toHaveText('Playwright Tester')
      await expect(page.getByLabel('Bio')).toHaveValue('Hello from the browser')
    })

    test('upload an avatar straight to object storage via a presigned URL', async () => {
      await page
        .getByTestId('avatar-input')
        .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
      await expect(page.getByText('Profile picture updated')).toBeVisible()
      const img = page.getByRole('img', { name: /Profile picture/ })
      await expect(img).toBeVisible()
      expect(await img.getAttribute('src')).toContain(':8333/')
      // The image actually loads (and is decoded) from SeaweedFS
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(1)

      await page.reload()
      await expect(page.getByRole('img', { name: /Profile picture/ })).toBeVisible()
    })

    test('rejects an oversized file on the client without calling the API', async () => {
      await page.getByTestId('avatar-input').setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(3 * 1024 * 1024),
      })
      await expect(page.getByText('Image must be at most 2 MB')).toBeVisible()
    })

    test('change email: only takes effect after confirming from the new mailbox', async () => {
      const before = await countMails(newEmail, 'Confirm')
      await page.getByLabel('New email').fill(newEmail)
      await page.getByRole('button', { name: 'Send confirmation link' }).click()
      await expect(page.getByText(`Confirmation link sent to ${newEmail}`)).toBeVisible()
      await expect(page.getByTestId('account-email')).toHaveText(email) // not changed yet

      await page.goto(await linkFromMail(newEmail, 'Confirm', before))
      await expect(page.getByText('Email changed')).toBeVisible()
      await page.getByRole('link', { name: 'Back to home' }).click()
      await expect(page.getByTestId('account-email')).toHaveText(newEmail)
    })

    test('sign out ends the session', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/login$/)
      await page.goto('/')
      await expect(page).toHaveURL(/\/login$/)
      await page.reload()
      await expect(page).toHaveURL(/\/login$/) // the refresh cookie has been revoked
    })
  })
