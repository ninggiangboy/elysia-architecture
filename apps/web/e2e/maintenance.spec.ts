import { expect, test } from '@playwright/test'

// The server side is covered by the API's own tests; here the browser is handed the answers a deploy would produce.
const health = (maintenance: boolean) => ({
  status: 200,
  json: { status: 'ready', database: 'up', maintenance },
})

async function submitSignIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('maintenance@example.test')
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
}

async function expectNoWayOut(
  dialog: import('@playwright/test').Locator,
  page: import('@playwright/test').Page,
) {
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)
  await expect(dialog).toBeVisible()
}

test('maintenance mode puts up a dialog that cannot be dismissed, and removes it when the deploy is over', async ({
  page,
}) => {
  let over = false
  await page.route('**/api/health/ready', (route) => route.fulfill(health(!over)))
  await page.route('**/api/auth/magic-link', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'retry-after': '30' },
      json: { error: { code: 'maintenance', message: 'The service is being updated' } },
    }),
  )

  await submitSignIn(page)
  const dialog = page.getByRole('alertdialog', { name: "We're updating the app" })
  await expect(dialog).toBeVisible()
  await expectNoWayOut(dialog, page)

  over = true
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

test('a gateway error with the API really down shows the same kind of dialog, and closes when it is back', async ({
  page,
}) => {
  let up = false
  // What nginx says while the app is stopped: 502 for the request and for the health probe alike.
  await page.route('**/api/health/ready', (route) =>
    up
      ? route.fulfill(health(false))
      : route.fulfill({ status: 502, body: '<html>Bad Gateway</html>' }),
  )
  await page.route('**/api/auth/magic-link', (route) =>
    route.fulfill({ status: 502, body: '<html>Bad Gateway</html>' }),
  )

  await submitSignIn(page)
  const dialog = page.getByRole('alertdialog', { name: "We can't reach the server" })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expectNoWayOut(dialog, page)

  up = true
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

test('a gateway error while the API is fine shows no dialog', async ({ page }) => {
  await page.route('**/api/health/ready', (route) => route.fulfill(health(false)))
  await page.route('**/api/auth/magic-link', (route) =>
    route.fulfill({ status: 504, body: '<html>Gateway Timeout</html>' }),
  )

  await submitSignIn(page)
  await page.waitForTimeout(1500)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})
