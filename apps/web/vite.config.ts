import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // The kit packages point their `bun` export condition at TypeScript source: the build reads that, not dist/.
    conditions: ['bun'],
  },
  server: {
    port: 5173,
    // Same origin as the web app → the refresh cookie (Path=/api/auth, SameSite=Lax) works without CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
