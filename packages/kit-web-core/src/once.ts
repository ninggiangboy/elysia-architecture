const calls = new Map<string, Promise<unknown>>()

/**
 * Ensures `fn` runs only once per `key` even if the component mounts several times (React StrictMode).
 * Needed for one-time tokens such as magic links.
 */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = calls.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn()
    calls.set(key, p)
  }
  return p
}
