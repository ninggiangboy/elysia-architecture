/**
 * A sign-in that a callback page could not finish (the provider's or the link's first step worked, but a second factor or
 * a sign-up form is still due). The login page picks it up, so the person continues where they are instead of starting over.
 */
export type PendingSignIn =
  | { kind: 'mfa'; token: string }
  | {
      kind: 'signup'
      token: string
      email: string
      suggestedName: string | null
      termsVersion: string
    }

let pending: PendingSignIn | null = null

export const pendingSignIn = {
  set(next: PendingSignIn) {
    pending = next
  },
  /** Reading does not clear it: React may render twice. The login page clears it in an effect. */
  peek: () => pending,
  clear() {
    pending = null
  },
}

/** What a first-step answer leaves to do; `null` when the session started. */
export function pendingFrom(outcome: {
  status: string
  mfaToken?: string
  signupToken?: string
  email?: string
  suggestedName?: string | null
  termsVersion?: string
}): PendingSignIn | null {
  if (outcome.status === 'mfa_required' && outcome.mfaToken) {
    return { kind: 'mfa', token: outcome.mfaToken }
  }
  if (outcome.status === 'signup_required' && outcome.signupToken) {
    return {
      kind: 'signup',
      token: outcome.signupToken,
      email: outcome.email ?? '',
      suggestedName: outcome.suggestedName ?? null,
      termsVersion: outcome.termsVersion ?? '',
    }
  }
  return null
}
