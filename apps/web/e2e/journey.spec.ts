import { expect, type Page, test } from '@playwright/test'
import { codeFromMail, countMails, linkFromMail, PNG, TEST_IP } from './support'

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
      // The profile row is created asynchronously after sign-up. If the page loaded before that (version 0), the first save
      // conflicts, but only with default values this form did not change, so it is retried on the new version.
      await expect(async () => {
        await page.getByRole('button', { name: 'Save changes' }).click()
        await expect(page.getByText('Changes saved')).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await expect(page.getByTestId('display-name')).toHaveText('Playwright Tester')

      await page.reload()
      await expect(page.getByTestId('display-name')).toHaveText('Playwright Tester')
      await expect(page.getByLabel('Bio')).toHaveValue('Hello from the browser')
    })

    test('a concurrent edit from another tab asks whether to load it or overwrite it', async () => {
      const other = await page.context().newPage()
      await other.goto('/')
      const editElsewhere = async (name: string) => {
        await other.getByLabel('Display name').fill(name)
        await other.getByRole('button', { name: 'Save changes' }).click()
        await expect(other.getByText('Changes saved')).toBeVisible()
      }
      const conflict = page.getByTestId('profile-conflict')

      // Overwrite: our edit wins over the newer version.
      await page.getByLabel('Display name').fill('Mine')
      await editElsewhere('Theirs')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(conflict).toContainText('Theirs')
      await expect(page.getByLabel('Display name')).toHaveValue('Mine') // edits are kept
      await page.getByRole('button', { name: 'Overwrite with mine' }).click()
      await expect(page.getByText('Changes saved')).toBeVisible()
      await expect(conflict).toBeHidden()
      await expect(page.getByTestId('display-name')).toHaveText('Mine')

      // Load latest: our edit is dropped for the newer version.
      await page.getByLabel('Display name').fill('Mine again')
      await other.reload()
      await editElsewhere('Theirs again')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.getByRole('button', { name: 'Load latest' }).click()
      await expect(conflict).toBeHidden()
      await expect(page.getByLabel('Display name')).toHaveValue('Theirs again')

      await other.close()
      await page.getByLabel('Display name').fill('Playwright Tester')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Changes saved').first()).toBeVisible()
    })

    test('upload an avatar straight to object storage via a presigned URL', async () => {
      await page
        .getByTestId('avatar-input')
        .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
      // The picked photo opens in a crop dialog; nothing is uploaded until Save
      const dialog = page.getByRole('dialog', { name: 'Profile picture' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('slider', { name: 'Zoom' }).fill('2')
      await dialog.getByTestId('crop-frame').press('ArrowLeft')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Profile picture updated')).toBeVisible()
      await expect(dialog).toBeHidden()
      const img = page.getByRole('img', { name: /Profile picture/ })
      await expect(img).toBeVisible()
      expect(await img.getAttribute('src')).toContain(':8333/')
      // The saved image is the 512px crop, and it actually loads (and is decoded) from SeaweedFS
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(512)

      await page.reload()
      await expect(page.getByRole('img', { name: /Profile picture/ })).toBeVisible()
    })

    test('upload a cover image straight to object storage via a presigned URL', async () => {
      await page
        .getByTestId('cover-input')
        .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG })
      const dialog = page.getByRole('dialog', { name: 'Cover image' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Cover image updated')).toBeVisible()
      await expect(dialog).toBeHidden()
      const img = page.getByRole('img', { name: 'Cover' })
      await expect(img).toBeVisible()
      expect(await img.getAttribute('src')).toContain(':8333/')
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(1600)

      await page.reload()
      await expect(page.getByRole('img', { name: 'Cover' })).toBeVisible()
    })

    test('cancelling the crop dialog uploads nothing', async () => {
      await page
        .getByTestId('avatar-input')
        .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
      const dialog = page.getByRole('dialog', { name: 'Profile picture' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText('Profile picture updated')).toBeHidden()
    })

    test('rejects an oversized file on the client without calling the API', async () => {
      await page.getByTestId('avatar-input').setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(21 * 1024 * 1024),
      })
      await expect(page.getByText('Image must be at most 20 MB')).toBeVisible()
    })

    test('a file that is not a decodable image closes the dialog with an error', async () => {
      await page.getByTestId('avatar-input').setInputFiles({
        name: 'broken.png',
        mimeType: 'image/png',
        buffer: Buffer.from('not an image'),
      })
      await expect(page.getByText('Could not read this image')).toBeVisible()
      await expect(page.getByRole('dialog')).toBeHidden()
    })

    test('change email: only takes effect after confirming from the new mailbox', async () => {
      const before = await countMails(newEmail, 'Confirm')
      await page.getByLabel('New email').fill(newEmail)
      await page.getByRole('button', { name: 'Send confirmation link' }).click()

      // The earlier reload restored the session from the cookie, which no longer counts as a recent sign-in:
      // changing the email asks to confirm it is really the owner (here with a code sent to the current email).
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' })
      await expect(dialog).toBeVisible()
      const codes = await countMails(email, 'confirmation code')
      await dialog.getByRole('button', { name: 'Email me a code' }).click()
      await dialog.getByLabel('Confirmation code').fill(await codeFromMail(email, codes))
      await dialog.getByRole('button', { name: 'Confirm' }).click()

      await expect(page.getByText(`Confirmation link sent to ${newEmail}`)).toBeVisible()
      await expect(page.getByTestId('account-email')).toHaveText(email) // not changed yet

      await page.goto(await linkFromMail(newEmail, 'Confirm', before))
      await expect(page.getByText('Email changed')).toBeVisible()
      await page.getByRole('link', { name: 'Back to home' }).click()
      await expect(page.getByTestId('account-email')).toHaveText(newEmail)
    })

    test('lists the signed-in devices, marking this one', async () => {
      const list = page.getByTestId('sessions')
      await expect(list.getByRole('listitem')).toHaveCount(1)
      await expect(list.getByText('This device')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign out all other devices' })).toHaveCount(0)
    })

    test('sign out ends the session', async () => {
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/login$/)
      await page.goto('/')
      await expect(page).toHaveURL(/\/login$/)
      await page.reload()
      await expect(page).toHaveURL(/\/login$/) // the refresh cookie has been revoked
    })
  })
