export type SendGrant = { ok: true } | { ok: false; retryAfterMs: number }

/**
 * Bộ giới hạn tốc độ gửi mail, dùng chung giữa các instance. Hiện cài bằng Postgres;
 * thay bằng Redis/dịch vụ khác chỉ cần cài lại port này.
 */
export interface SendRateLimiter {
  /** Xin phép gửi MỘT mail. Từ chối kèm thời gian nên thử lại. */
  acquire(): Promise<SendGrant>
  /** Nhà cung cấp báo quá tốc độ: chặn mọi instance trong `ms` tới. */
  penalize(ms: number): Promise<void>
}
