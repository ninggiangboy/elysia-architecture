import { defineConfig } from '@playwright/test'
import { TEST_IP } from './e2e/support'

// Cần hạ tầng đang chạy (`bun run infra:up`) và đã migrate. Playwright tự bật api + web nếu chưa chạy.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    extraHTTPHeaders: { 'x-forwarded-for': TEST_IP },
  },
  webServer: [
    {
      command: 'bun --env-file=../../.env ../api/src/main.ts',
      url: 'http://localhost:3000/api/health/live',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'bun run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
