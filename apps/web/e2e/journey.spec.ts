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
      const before = await countMails(email, 'đăng nhập')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Gửi liên kết đăng nhập' }).click()
      await expect(page.getByText('Kiểm tra hộp thư của bạn')).toBeVisible()

      await page.goto(await linkFromMail(email, 'đăng nhập', before))
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
      await expect(anon.getByText('Không thể đăng nhập')).toBeVisible()
      await expect(anon.getByText('invalid or has expired')).toBeVisible()
      await context.close()
    })

    test('edit the profile; it survives a reload because the refresh cookie restores the session', async () => {
      await page.getByLabel('Tên hiển thị').fill('Nguyễn Playwright')
      await page.getByLabel('Giới thiệu').fill('Xin chào từ trình duyệt')
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
      await expect(page.getByText('Đã lưu thay đổi')).toBeVisible()
      await expect(page.getByTestId('display-name')).toHaveText('Nguyễn Playwright')

      await page.reload()
      await expect(page.getByTestId('display-name')).toHaveText('Nguyễn Playwright')
      await expect(page.getByLabel('Giới thiệu')).toHaveValue('Xin chào từ trình duyệt')
    })

    test('upload an avatar straight to object storage via a presigned URL', async () => {
      await page
        .getByTestId('avatar-input')
        .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
      await expect(page.getByText('Đã cập nhật ảnh đại diện')).toBeVisible()
      const img = page.getByRole('img', { name: /Ảnh đại diện/ })
      await expect(img).toBeVisible()
      expect(await img.getAttribute('src')).toContain(':8333/')
      // Ảnh thực sự tải được (và đã decode) từ SeaweedFS
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBe(1)

      await page.reload()
      await expect(page.getByRole('img', { name: /Ảnh đại diện/ })).toBeVisible()
    })

    test('rejects an oversized file on the client without calling the API', async () => {
      await page.getByTestId('avatar-input').setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(3 * 1024 * 1024),
      })
      await expect(page.getByText('Ảnh tối đa 2 MB')).toBeVisible()
    })

    test('change email: only takes effect after confirming from the new mailbox', async () => {
      const before = await countMails(newEmail, 'Xác nhận')
      await page.getByLabel('Email mới').fill(newEmail)
      await page.getByRole('button', { name: 'Gửi liên kết xác nhận' }).click()
      await expect(page.getByText(`Đã gửi liên kết xác nhận tới ${newEmail}`)).toBeVisible()
      await expect(page.getByTestId('account-email')).toHaveText(email) // chưa đổi

      await page.goto(await linkFromMail(newEmail, 'Xác nhận', before))
      await expect(page.getByText('Đã đổi email')).toBeVisible()
      await page.getByRole('link', { name: 'Về trang chủ' }).click()
      await expect(page.getByTestId('account-email')).toHaveText(newEmail)
    })

    test('sign out ends the session', async () => {
      await page.getByRole('button', { name: 'Đăng xuất' }).click()
      await expect(page).toHaveURL(/\/login$/)
      await page.goto('/')
      await expect(page).toHaveURL(/\/login$/)
      await page.reload()
      await expect(page).toHaveURL(/\/login$/) // cookie refresh đã bị thu hồi
    })
  })
