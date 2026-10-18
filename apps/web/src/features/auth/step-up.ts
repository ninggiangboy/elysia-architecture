import { ApiError, http, unwrap } from '@/lib/api'
import { applyAccessToken } from '@/lib/session'
import { getPasskey } from '@/lib/webauthn'

/** The person closed the "confirm it is you" dialog. Callers stop quietly instead of showing an error. */
class StepUpCancelled extends Error {
  constructor() {
    super('Confirmation cancelled')
  }
}

export const isStepUpCancelled = (err: unknown) => err instanceof StepUpCancelled

type Listener = (open: boolean) => void
let pending: {
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
} | null = null
const listeners = new Set<Listener>()

export const stepUpDialog = {
  isOpen: () => pending !== null,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Called by the dialog: confirmed, or dismissed. */
  settle(ok: boolean) {
    const current = pending
    pending = null
    for (const l of listeners) l(false)
    if (ok) current?.resolve()
    else current?.reject(new StepUpCancelled())
  },
}

/** Opens the dialog (once, however many actions are waiting) and resolves when the user has confirmed. */
function confirmIdentity(): Promise<void> {
  if (!pending) {
    let resolve!: () => void
    let reject!: (err: unknown) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    pending = { promise, resolve, reject }
    for (const l of listeners) l(true)
  }
  return pending.promise
}

/**
 * Runs a sensitive action. If the server answers `step_up_required`, asks the user to confirm (passkey or emailed
 * code), then runs it once more with the fresh access token. Rejects with `StepUpCancelled` if they back out.
 */
export async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'step_up_required')) throw err
    await confirmIdentity()
    return action()
  }
}

export async function confirmWithPasskey() {
  const begin = unwrap(await http.api.account['step-up'].passkey.options.post())
  const response = await getPasskey(begin.options)
  const next = unwrap(
    await http.api.account['step-up'].passkey.verify.post({
      challengeId: begin.challengeId,
      response,
    }),
  )
  applyAccessToken(next.accessToken)
}

export const sendConfirmationCode = async () =>
  unwrap(await http.api.account['step-up']['email-code'].post())

export async function confirmWithCode(code: string) {
  const next = unwrap(await http.api.account['step-up']['email-code'].verify.post({ code }))
  applyAccessToken(next.accessToken)
}

/** Confirms with a code from the authenticator app. */
export async function confirmWithTotp(code: string) {
  const next = unwrap(await http.api.account['step-up'].totp.post({ code }))
  applyAccessToken(next.accessToken)
}

export async function confirmWithPassword(password: string) {
  const next = unwrap(await http.api.account['step-up'].password.post({ password }))
  applyAccessToken(next.accessToken)
}
