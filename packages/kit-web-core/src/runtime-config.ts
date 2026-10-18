/**
 * Runtime config is read from /config.json served by the web server — one build serves many environments.
 * An empty `apiOrigin` = same origin as the web app (via the Vite proxy in dev, via nginx in production).
 */
export interface RuntimeConfig {
  apiOrigin: string
}

declare global {
  interface Window {
    /** Started by an inline script in index.html so the request overlaps the bundle download. */
    __config?: Promise<Partial<RuntimeConfig>>
  }
}

let config: RuntimeConfig = { apiOrigin: '' }

async function fetchConfig(): Promise<Partial<RuntimeConfig>> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) return await res.json()
  } catch {
    // use the defaults
  }
  return {}
}

export async function loadRuntimeConfig(): Promise<void> {
  config = { ...config, ...(await (window.__config ?? fetchConfig())) }
}

export const apiOrigin = () => config.apiOrigin || window.location.origin
