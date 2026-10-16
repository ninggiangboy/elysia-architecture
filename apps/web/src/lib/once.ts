const calls = new Map<string, Promise<unknown>>()

/**
 * Đảm bảo `fn` chỉ chạy một lần cho mỗi `key` dù component mount nhiều lần (React StrictMode).
 * Cần cho các token dùng một lần như magic link.
 */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = calls.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn()
    calls.set(key, p)
  }
  return p
}
