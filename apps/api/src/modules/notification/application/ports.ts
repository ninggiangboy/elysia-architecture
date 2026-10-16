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
