export type SmtpFailure =
  | { kind: 'rate_limited'; retryAfterMs?: number }
  | { kind: 'permanent' }
  | { kind: 'transient' }

interface SmtpLikeError {
  responseCode?: number
  response?: string
  message?: string
}

const THROTTLE_TEXT = /throttl|rate.?limit|too many|quota|sending rate|frequency/i
const PERMANENT_CODES = new Set([550, 551, 552, 553, 554, 555])
// 421 service temporarily unavailable · 450/451/452 mailbox/system temporarily busy · 454 = SES "Throttling failure"
const TEMPORARY_REJECT_CODES = new Set([421, 450, 451, 452, 454])

/**
 * Classifies SMTP errors so the relay handles them correctly:
 *  - rate_limited: retry later, does not count as an attempt (SES: 454 "Maximum sending rate exceeded", "Daily message quota exceeded")
 *  - permanent:    can never be sent → drop this mail (550 mailbox does not exist, 554 rejected…)
 *  - transient:    other errors (lost connection, timeout, bad credentials 535…) → normal backoff, counts as an attempt
 *
 * Check the message text before the code: Gmail reports quota with 550 5.4.5, SES sandbox/rejection with 554.
 */
export function classifySmtpError(err: unknown): SmtpFailure {
  const e = (err ?? {}) as SmtpLikeError
  const code = e.responseCode
  const text = `${e.response ?? ''} ${e.message ?? ''}`
  if (code !== undefined && code >= 400 && code < 600 && THROTTLE_TEXT.test(text)) {
    return { kind: 'rate_limited' }
  }
  if (code !== undefined && TEMPORARY_REJECT_CODES.has(code)) return { kind: 'rate_limited' }
  if (code !== undefined && PERMANENT_CODES.has(code)) return { kind: 'permanent' }
  return { kind: 'transient' }
}
