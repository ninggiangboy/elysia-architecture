import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadRuntimeConfig } from '@/lib/config'

// Config must be ready before the api client is created → import the app only after the config has loaded.
await loadRuntimeConfig()
const { App } = await import('./app')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
