import { defineConfig } from '@playwright/test'
import { TEST_IP } from './e2e/support'

// Needs the infrastructure running (`bun run infra:up`) and migrated. Playwright starts api + web itself if they are not running.
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
