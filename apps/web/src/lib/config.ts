/**
 * Runtime config is read from /config.json served by the web server — one build serves many environments.
 * An empty `apiOrigin` = same origin as the web app (via the Vite proxy in dev, via nginx in production).
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
    // use the defaults
  }
}

export const apiOrigin = () => config.apiOrigin || window.location.origin
