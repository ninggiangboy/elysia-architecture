import { authStore } from './auth-store'
import { apiOrigin } from './config'
import { refreshSession } from './session'

/** One event as the server sends it (`id`/`at` are absent on the protocol-level `ready` / `pong`). */
export interface RealtimeMessage {
  id?: string
  type: string
  data?: Record<string, unknown>
  at?: string
}

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface RealtimeListener {
  onStatus?(status: RealtimeStatus): void
  onMessage(message: RealtimeMessage): void
}

export interface RealtimeHandle {
  close(): void
}

const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000)

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/** `type: 'session.revoked'` for the session this connection belongs to → the server is about to hang up; do not reconnect. */
const endsConnection = (m: RealtimeMessage, ownSessionId: unknown) =>
  m.type === 'session.revoked' && ownSessionId !== undefined && m.data?.sessionId === ownSessionId

/**
 * Server-Sent Events over `fetch` (EventSource cannot send the Authorization header).
 * Reconnects with backoff; every (re)connect reports `open` again so callers can refetch what they missed.
 */
export function connectSse(listener: RealtimeListener): RealtimeHandle {
  const stop = new AbortController()

  void (async () => {
    let attempt = 0
    while (!stop.signal.aborted) {
      listener.onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting')
      const token = authStore.get().accessToken
      if (!token) break
      let finished = false
      try {
        const res = await fetch(`${apiOrigin()}/api/realtime/events`, {
          headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
          signal: stop.signal,
        })
        if (res.status === 401) {
          if (await refreshSession()) continue
          break
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let ownSessionId: unknown
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          for (let sep = buffer.indexOf('\n\n'); sep !== -1; sep = buffer.indexOf('\n\n')) {
            const frame = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            const event = /^event: (.*)$/m.exec(frame)?.[1]
            const data = /^data: (.*)$/m.exec(frame)?.[1]
            if (!event || !data) continue // heartbeat comment
            const message: RealtimeMessage =
              event === 'ready' ? { type: 'ready', data: JSON.parse(data) } : JSON.parse(data)
            if (event === 'ready') {
              attempt = 0
              ownSessionId = message.data?.sessionId
              listener.onStatus?.('open')
            }
            listener.onMessage(message)
            if (endsConnection(message, ownSessionId)) finished = true
          }
        }
      } catch {
        if (stop.signal.aborted) break
      }
      if (finished) break
      await sleep(backoff(attempt++), stop.signal)
    }
    listener.onStatus?.('closed')
  })()

  return { close: () => stop.abort() }
}
