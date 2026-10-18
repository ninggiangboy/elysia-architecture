export type SendGrant = { ok: true } | { ok: false; retryAfterMs: number }

/**
 * Mail send rate limiter, shared across instances. Currently implemented with Postgres;
 * swapping in Redis/another service only requires reimplementing this port.
 */
export interface SendRateLimiter {
  /** Asks permission to send ONE mail. On refusal, says how long to wait before retrying. */
  acquire(): Promise<SendGrant>
  /** The provider reported an over-rate condition: block every instance for the next `ms`. */
  penalize(ms: number): Promise<void>
}

/** What the service worker needs to show a notification. Kept small: push payloads are limited to ~4 KB. */
export interface PushMessage {
  /** The notification id; used as the browser notification `tag`, so a redelivery replaces instead of duplicating. */
  id: string
  title: string
  body: string
  /** In-app path to open on click. */
  link: string
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * - `delivered`: accepted by the push service.
 * - `gone`: the subscription no longer exists (user revoked permission, browser profile deleted) → delete it.
 * - `rejected`: refused for good (bad request/payload/VAPID) → drop this message, keep the subscription.
 * - `retry`: push service busy or unreachable → try again later.
 */
export type PushOutcome = 'delivered' | 'gone' | 'rejected' | 'retry'

/** Web Push (RFC 8030) with VAPID. Currently implemented with the `web-push` library. */
export interface WebPushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>
}
