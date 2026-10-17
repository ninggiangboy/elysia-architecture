/**
 * Synchronous API profile offers to other modules. Plain DTOs (serializable) — currently in-process, when split into a
 * service just swap in an HTTP client with the same interface. Callers must tolerate errors/timeouts.
 */
export interface ProfileApi {
  /** The name the user goes by; `null` when there is no profile (yet). */
  getDisplayName(userId: string): Promise<string | null>
}
