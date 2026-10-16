/**
 * Cấu hình chạy (runtime) lấy từ /config.json do web server phục vụ — một bản build dùng cho nhiều môi trường.
 * `apiOrigin` rỗng = cùng origin với web (qua Vite proxy khi dev, qua nginx khi chạy thật).
 */
interface RuntimeConfig {
  apiOrigin: string
}

let config: RuntimeConfig = { apiOrigin: '' }

export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) config = { ...config, ...(await res.json()) }
  } catch {
    // dùng mặc định
  }
}

export const apiOrigin = () => config.apiOrigin || window.location.origin
