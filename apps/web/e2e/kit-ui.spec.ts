import { expect, test } from '@playwright/test'

// The components live in packages/kit-ui, outside the folder Tailwind scans by default; `@source` in src/index.css adds it.
// A smoke test that a kit-ui component arrives styled (the production build is checked by comparing its CSS size).
test('classes used only by @kit/ui components are in the stylesheet', async ({ page }) => {
  await page.goto('/login')
  const button = page.getByRole('button', { name: 'Send sign-in link' })
  await expect(button).toBeVisible()
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      background: s.backgroundColor,
      radius: s.borderRadius,
      height: s.height,
      shadow: s.boxShadow,
    }
  })
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(style.radius).not.toBe('0px')
  expect(Number.parseFloat(style.height)).toBeGreaterThanOrEqual(36)
  expect(style.shadow).not.toBe('none')
})
