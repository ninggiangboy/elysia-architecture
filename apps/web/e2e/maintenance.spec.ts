import { expect, test } from '@playwright/test'

// The server side is covered by the API's own tests; here the browser is handed the answers a deploy would produce.
const maintenance = (on: boolean) => ({
  status: 200,
  json: { status: 'ready', database: 'up', maintenance: on },
})

test('maintenance mode puts up a dialog that cannot be dismissed, and removes it when the deploy is over', async ({
  page,
}) => {
  let over = false
  await page.route('**/api/health/ready', (route) => route.fulfill(maintenance(!over)))
  await page.route('**/api/auth/magic-link', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'retry-after': '30' },
      json: { error: { code: 'maintenance', message: 'The service is being updated' } },
    }),
  )

  await page.goto('/login')
  await page.getByLabel('Email').fill('maintenance@example.test')
  await page.getByRole('button', { name: 'Send sign-in link' }).click()

  const dialog = page.getByRole('alertdialog', { name: "We're updating the app" })
  await expect(dialog).toBeVisible()

  // No way out: not Esc, not a click beside it.
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)
  await expect(dialog).toBeVisible()

  over = true
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})
