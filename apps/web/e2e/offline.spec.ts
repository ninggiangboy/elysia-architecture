import { expect, test } from '@playwright/test'

test('opening the app with no connection shows the offline page, and the app comes back when the network does', async ({
  page,
  context,
}) => {
  await page.goto('/login')
  // The worker is registered on load; the offline page is cached when it installs.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await expect
    .poll(() => page.evaluate(() => caches.match('/offline.html').then((r) => !!r)))
    .toBe(true)
  // Take control of the page so a reload goes through the worker.
  await page.reload()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible()

  await context.setOffline(false)
  // The page reloads by itself on the `online` event.
  await expect(page.getByLabel('Email')).toBeVisible()
})
