import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadRuntimeConfig } from '@/lib/config'

// Config must be ready before the api client is created → import the app only after the config has loaded.
await loadRuntimeConfig()
const [{ App }, { router }] = await Promise.all([import('./app'), import('./router')])

// Resolve the first route (session, loaders, code-split chunks) before the first render: the page then appears whole,
// instead of a blank screen followed by everything popping in. The boot splash in index.html covers the wait.
await router.load().catch(console.error)

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The service worker serves the offline page when the app is opened with no connection (public/sw.js). It is registered on
// every load, not only when push is turned on, or a first offline visit after a normal one would find nothing to serve it.
// After the first render, so installing it never competes with the page for bandwidth (`load` may already have fired by now).
if ('serviceWorker' in navigator) {
  const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => {})
  if (document.readyState === 'complete') register()
  else addEventListener('load', register)
}
