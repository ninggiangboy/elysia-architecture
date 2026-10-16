export interface AccountDto {
  id: string
  email: string
  /** ISO-8601 */
  createdAt: string
}

/**
 * API đồng bộ identity cung cấp cho module khác. DTO thuần (serialize được) — hiện chạy in-process,
 * khi tách service chỉ cần thay bằng HTTP client cùng interface. Caller phải chịu được lỗi/timeout.
 */
export interface IdentityApi {
  getAccount(userId: string): Promise<AccountDto | null>
}
