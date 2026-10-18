import { expect, type Page, test } from '@playwright/test'
import { totpCode } from '../../../packages/kit-auth/src/totp'
import { codeFromSubject, countMails, linkFromMail, TEST_IP } from './support'

const email = `pw-pass-${Date.now()}@example.test`
const PASSWORD = 'correct horse battery'

let page: Page

async function signOut() {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

async function signInWithPassword(password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test.describe
  .serial('password sign-up, two-step verification and a forgotten password', () => {
    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5173',
        extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
      })
      page = await context.newPage()
    })
    test.afterAll(async () => page.context().close())

    test('the sign-in page offers a password, a link, a passkey and the way to sign up', async () => {
      await page.goto('/login')
      await expect(page.getByLabel('Password')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible()
      await page.getByRole('link', { name: 'Create an account' }).click()
      await expect(page).toHaveURL(/\/register$/)
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    })

    test('sign up with a password: the account exists once the emailed code is typed', async () => {
      await page.goto('/register')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Name (optional)').fill('Pass Word')
      await page.getByLabel('Password').fill('short')
      await page.getByRole('button', { name: 'Create account' }).click()
      // The browser refuses a password under the minimum before anything is sent.
      await expect(page.getByText('Confirm your email')).toHaveCount(0)

      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()

      await page.getByLabel(/6-digit code/).fill('000000')
      await page.getByRole('button', { name: 'Confirm and sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible()

      await page.getByLabel(/6-digit code/).fill(await codeFromSubject(email, 'Confirm your email'))
      await page.getByRole('button', { name: 'Confirm and sign in' }).click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('account-email')).toHaveText(email)
    })

    test('sign out, then sign in with the password; a wrong one is refused', async () => {
      await signOut()
      await signInWithPassword('not the password!')
      await expect(page.getByText('Email or password is incorrect')).toBeVisible()
      await signInWithPassword()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('account-email')).toHaveText(email)
    })

    test('turn on two-step verification, keep the recovery codes, and the next sign-in asks for a code', async () => {
      await page.goto('/settings/security')
      // A page load drops the "recently confirmed" mark: turning it on asks to confirm first, with the password.
      await page.getByRole('button', { name: 'Turn on' }).click()
      await page.getByRole('button', { name: 'Use my password' }).click()
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()

      const secret = (await page.getByTestId('totp-secret').textContent()) ?? ''
      expect(secret).toMatch(/^[A-Z2-7]{32}$/)
      await page.getByLabel('Code from the app').fill(totpCode(secret, new Date()))
      await page.getByRole('button', { name: 'Turn on' }).last().click()

      await expect(page.getByTestId('recovery-codes').getByRole('listitem')).toHaveCount(10)
      await page.getByRole('button', { name: 'I have saved them' }).click()

      await signOut()
      await signInWithPassword()
      await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
      // A code is good once: the enrolment used this 30-second step, so the app's next one is entered.
      await page
        .getByLabel('Authenticator code')
        .fill(totpCode(secret, new Date(Date.now() + 30_000)))
      await page.getByRole('button', { name: 'Verify' }).click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('account-email')).toHaveText(email)
    })

    test('a magic link is followed by the same second step; a recovery code works too', async () => {
      await signOut()
      await page.goto('/login')
      const before = await countMails(email, 'sign-in')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send sign-in link' }).click()
      await expect(page.getByText('Check your inbox')).toBeVisible()
      await page.goto(await linkFromMail(email, 'sign-in', before))
      await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()

      await page.getByRole('button', { name: 'Use a recovery code' }).click()
      await page.getByLabel('Recovery code').fill('wrong-codes')
      await page.getByRole('button', { name: 'Verify' }).click()
      await expect(page.getByText('This code is wrong or has expired')).toBeVisible()
    })

    test('forgot the password: the mailed link sets a new one', async () => {
      await page.goto('/login')
      await page.getByRole('link', { name: 'Forgot password?' }).click()
      // The route's chunk loads after the URL changes: wait for the page itself, or the login field gets typed into.
      await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send reset link' }).click()
      await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()

      await page.goto(await linkFromMail(email, 'Reset your password'))
      await page.getByLabel('New password').fill('a brand new password')
      await page.getByRole('button', { name: 'Save password' }).click()
      await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible()

      await page.getByRole('link', { name: 'Back to sign in' }).click()
      await signInWithPassword(PASSWORD)
      await expect(page.getByText('Email or password is incorrect')).toBeVisible()
    })
  })
