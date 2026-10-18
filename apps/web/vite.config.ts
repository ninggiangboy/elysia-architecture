import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // The kit packages point their `bun` export condition at TypeScript source: the build reads that, not dist/.
    // Added to Vite's own conditions, not instead of them: without `browser`, packages such as TanStack Router resolve
    // their server build in the browser.
    conditions: ['bun', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    // Same origin as the web app → the refresh cookie (Path=/api/auth, SameSite=Lax) works without CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
