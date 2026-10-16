/**
 * Handler báo "chưa làm được lúc này, thử lại sau" (vd. bị rate limit của nhà cung cấp).
 * Relay lên lịch lại đúng thời điểm và KHÔNG tính vào số lần thử tối đa; chỉ bỏ cuộc khi quá ngân sách thời gian.
 */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    /** Gợi ý của nhà cung cấp (Retry-After) hoặc của bộ giới hạn tốc độ; bỏ trống = dùng mặc định. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}
