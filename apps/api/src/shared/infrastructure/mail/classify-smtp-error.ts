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
// 421 dịch vụ tạm không khả dụng · 450/451/452 hộp thư/hệ thống tạm bận · 454 = SES "Throttling failure"
const TEMPORARY_REJECT_CODES = new Set([421, 450, 451, 452, 454])

/**
 * Phân loại lỗi SMTP để relay xử lý đúng:
 *  - rate_limited: thử lại sau, không tính số lần thử (SES: 454 "Maximum sending rate exceeded", "Daily message quota exceeded")
 *  - permanent:    không bao giờ gửi được → bỏ mail này (550 hộp thư không tồn tại, 554 bị từ chối…)
 *  - transient:    lỗi khác (mất kết nối, timeout, sai thông tin đăng nhập 535…) → backoff thường, tính số lần thử
 *
 * Kiểm tra nội dung trước mã: Gmail báo quota bằng 550 5.4.5, SES sandbox/bị từ chối bằng 554.
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
