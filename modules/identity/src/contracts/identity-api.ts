export interface AccountDto {
  id: string
  email: string
  /** Language the account is addressed in (mail, notifications): a `Locale` of `@app/shared-types`. */
  locale: string
  /** ISO-8601 */
  createdAt: string
}

/**
 * Synchronous API identity offers to other modules. Plain DTOs (serializable) — currently in-process,
 * when split into a service just swap in an HTTP client with the same interface. Callers must tolerate errors/timeouts.
 */
export interface IdentityApi {
  getAccount(userId: string): Promise<AccountDto | null>
}
