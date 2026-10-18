/**
 * A handler signals "can't do this right now, retry later" (e.g. the provider's rate limit).
 * The relay reschedules at the right time and does NOT count it toward the max attempts; it gives up only when the time budget is exceeded.
 */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    /** Hint from the provider (Retry-After) or the rate limiter; leave empty to use the default. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}
