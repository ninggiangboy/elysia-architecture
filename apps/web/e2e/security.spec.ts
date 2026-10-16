import { expect, type Page, test } from '@playwright/test'
import { codeFromMail, countMails, linkFromMail, TEST_IP } from './support'

const email = `pw-sec-${Date.now()}@example.test`

let page: Page

async function signInWithMagicLink() {
  await page.goto('/login')
  const before = await countMails(email, 'sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()
  await page.goto(await linkFromMail(email, 'sign-in', before))
  await expect(page.getByTestId('account-email')).toHaveText(email)
}

/**
 * A full page load restores the session from the refresh cookie — and that access token no longer counts as a recent
 * confirmation. Lands on the account settings, where the email form is.
 */
async function becomeStale() {
  await page.goto('/settings/account')
  await expect(page.getByLabel('New email')).toBeVisible()
}

test.describe
  .serial('passkeys and confirming sensitive actions', () => {
    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5173',
        extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
      })
      page = await context.newPage()
      // A software authenticator that behaves like Touch ID / Windows Hello: discoverable, user-verifying, approves at once.
      const cdp = await context.newCDPSession(page)
      await cdp.send('WebAuthn.enable')
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      })
    })
    test.afterAll(async () => page.context().close())

    test('add a passkey from the security page', async () => {
      await signInWithMagicLink()
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menuitem', { name: 'Security' }).click()
      await expect(page).toHaveURL(/\/settings\/security$/)
      await expect(page.getByTestId('no-passkeys')).toBeVisible()

      // Signing in just now counts as a confirmation, so no extra prompt.
      await page.getByRole('button', { name: 'Add a passkey' }).click()
      await expect(page.getByText(/Passkey ".+" added/)).toBeVisible()
      await expect(page.getByTestId('passkey')).toHaveCount(1)
      await expect(page.getByTestId('no-passkeys')).toHaveCount(0)
    })

    test('sign out, then sign in with the passkey and no email', async () => {
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/login$/)

      await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('account-email')).toHaveText(email)
    })

    test('a sensitive change asks to confirm with the passkey, then goes through', async () => {
      await becomeStale()
      await page.getByLabel('New email').fill(`pw-sec-new-${Date.now()}@example.test`)
      await page.getByRole('button', { name: 'Send confirmation link' }).click()

      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Use a passkey' }).click()
      await expect(page.getByText(/Confirmation link sent to/)).toBeVisible()
      await expect(dialog).toBeHidden()
    })

    test('backing out of the confirmation changes nothing', async () => {
      await becomeStale()
      await page.getByLabel('New email').fill(`pw-sec-cancel-${Date.now()}@example.test`)
      await page.getByRole('button', { name: 'Send confirmation link' }).click()
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText(/Confirmation link sent to/)).toHaveCount(0)
    })

    test('confirm with an emailed code, then remove the passkey', async () => {
      // A full page load restores the session from the cookie: stale again.
      await page.goto('/security')
      await expect(page.getByTestId('passkey')).toHaveCount(1)
      await page.getByRole('button', { name: 'Remove' }).click()
      await page
        .getByRole('dialog', { name: 'Remove this passkey?' })
        .getByRole('button', { name: 'Remove' })
        .click()

      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' })
      await expect(dialog).toBeVisible()
      const seen = await countMails(email, 'confirmation code')
      await dialog.getByRole('button', { name: 'Email me a code' }).click()
      await dialog.getByLabel('Confirmation code').fill(await codeFromMail(email, seen))
      await dialog.getByRole('button', { name: 'Confirm' }).click()

      await expect(page.getByText('Passkey removed')).toBeVisible()
      await expect(page.getByTestId('no-passkeys')).toBeVisible()
    })
  })
