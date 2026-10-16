import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadRuntimeConfig } from '@/lib/config'

// Cấu hình phải sẵn sàng trước khi api client được khởi tạo → import app sau khi đã load config.
await loadRuntimeConfig()
const { App } = await import('./app')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
