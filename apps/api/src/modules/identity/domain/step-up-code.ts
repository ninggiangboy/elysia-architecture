export const STEP_UP_CODE_TTL_MS = 10 * 60_000
export const STEP_UP_CODE_MAX_ATTEMPTS = 5
/** Codes a user may request per window (counts every request, used or not). */
export const STEP_UP_CODE_MAX_PER_WINDOW = 5
export const STEP_UP_CODE_WINDOW_MS = 15 * 60_000

/** A one-time code mailed to the user to confirm a sensitive action. Only its hash is stored. */
export interface StepUpCode {
  id: string
  userId: string
  codeHash: string
  createdAt: Date
  expiresAt: Date
}
