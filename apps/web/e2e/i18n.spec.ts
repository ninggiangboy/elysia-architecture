import { expect, test } from '@playwright/test'
import { countMails, linkFromMail } from './support'

const email = `pw-i18n-${Date.now()}@example.test`

test('the app speaks the chosen language, mail included, and the account remembers it', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click()
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi')

  // The choice survives a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()

  // The sign-in mail is written in the language of the page that asked for it.
  const before = await countMails(email, 'đăng nhập')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Gửi liên kết đăng nhập' }).click()
  await expect(page.getByText('Kiểm tra hộp thư của bạn')).toBeVisible()
  await page.goto(await linkFromMail(email, 'đăng nhập', before))
  await expect(page.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toBeVisible()

  // A notification holds what its text is made from, so it reads in the language the app is in now: opened in
  // Vietnamese, then again after switching to English.
  await page.getByRole('button', { name: /^Thông báo/ }).click()
  await expect(page.getByTestId('notifications').getByText('Chào mừng bạn')).toBeVisible()
  await page.keyboard.press('Escape')

  // Switching while signed in is saved on the account: a fresh browser profile would open in English by itself,
  // yet after a reload this one still follows the choice.
  await page.getByRole('button', { name: 'Ngôn ngữ' }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /^Notifications/ }).click()
  await expect(page.getByTestId('notifications').getByText('Welcome aboard')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.removeItem('locale'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
})
