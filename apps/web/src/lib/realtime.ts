import { authStore } from './auth-store'
import { apiOrigin } from './config'
import { watchNetworkFailure, watchResponse } from './maintenance'
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

/** One SSE frame → message; `undefined` for heartbeat comments. */
function parseFrame(frame: string): { event: string; message: RealtimeMessage } | undefined {
  const event = /^event: (.*)$/m.exec(frame)?.[1]
  const data = /^data: (.*)$/m.exec(frame)?.[1]
  if (!event || !data) return undefined
  const message: RealtimeMessage =
    event === 'ready' ? { type: 'ready', data: JSON.parse(data) } : JSON.parse(data)
  return { event, message }
}

/**
 * Reads one connection to the end, calling `onFrame` per message.
 * Resolves `true` when the server ended this session's own connection (do not reconnect).
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  listener: RealtimeListener,
  onReady: () => void,
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let ownSessionId: unknown
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return finished
    buffer += decoder.decode(value, { stream: true })
    for (let sep = buffer.indexOf('\n\n'); sep !== -1; sep = buffer.indexOf('\n\n')) {
      const parsed = parseFrame(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
      if (!parsed) continue
      if (parsed.event === 'ready') {
        onReady()
        ownSessionId = parsed.message.data?.sessionId
        listener.onStatus?.('open')
      }
      listener.onMessage(parsed.message)
      if (endsConnection(parsed.message, ownSessionId)) finished = true
    }
  }
}

/** `again` = retry immediately (token was just refreshed), `retry` = back off first, `stop` = give up. */
type Outcome = 'again' | 'retry' | 'stop'

async function connectOnce(
  listener: RealtimeListener,
  signal: AbortSignal,
  lastEventId: { current?: string },
  onReady: () => void,
): Promise<Outcome> {
  const token = authStore.get().accessToken
  if (!token) return 'stop'
  try {
    const res = await fetch(`${apiOrigin()}/api/realtime/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
        // What EventSource would send by itself: the server replays what we missed since this event.
        ...(lastEventId.current ? { 'last-event-id': lastEventId.current } : {}),
      },
      signal,
    })
    if (res.status === 401) return (await refreshSession()) ? 'again' : 'stop'
    await watchResponse(res)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const tracked: RealtimeListener = {
      ...listener,
      onMessage(message) {
        // `ready` hands out the cursor; replayable events then move it forward.
        const cursor = message.type === 'ready' ? message.data?.cursor : message.id
        if (typeof cursor === 'string') lastEventId.current = cursor
        listener.onMessage(message)
      },
    }
    return (await readStream(res.body, tracked, onReady)) ? 'stop' : 'retry'
  } catch (err) {
    if (signal.aborted) return 'stop'
    void watchNetworkFailure(err)
    return 'retry'
  }
}

/**
 * Server-Sent Events over `fetch` (EventSource cannot send the Authorization header).
 * Reconnects with backoff, resuming from the last cursor/event id seen. Every (re)connect delivers a `ready` message; its
 * `data.resumed` says whether the replayable events missed while disconnected follow it (`true`) or may be lost (`false`).
 * Events that are not replayable ("something changed") are never replayed: refetch their state on every `ready`.
 */
export function connectSse(listener: RealtimeListener): RealtimeHandle {
  const stop = new AbortController()
  const lastEventId: { current?: string } = {}

  void (async () => {
    let attempt = 0
    while (!stop.signal.aborted) {
      listener.onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting')
      const outcome = await connectOnce(listener, stop.signal, lastEventId, () => {
        attempt = 0
      })
      if (outcome === 'stop') break
      if (outcome === 'retry') await sleep(backoff(attempt++), stop.signal)
    }
    listener.onStatus?.('closed')
  })()

  return { close: () => stop.abort() }
}
