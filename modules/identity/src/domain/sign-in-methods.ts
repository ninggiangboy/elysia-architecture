import { ConflictError } from '@kit/core'

/** The ways a user could still sign in after a change. */
export interface RemainingSignInMethods {
  /** Email sign-in (link or code) is offered by the deployment: the account email is then always a way in. */
  emailSignIn: boolean
  password: boolean
  passkeys: number
  oauthAccounts: number
}

/** Removing a password, a passkey or a provider must never leave an account nobody can sign in to. */
export function assertKeepsASignInMethod(remaining: RemainingSignInMethods): void {
  const any =
    remaining.emailSignIn ||
    remaining.password ||
    remaining.passkeys > 0 ||
    remaining.oauthAccounts > 0
  if (!any) {
    throw new ConflictError(
      'last_sign_in_method',
      'Add another way to sign in before removing this one',
    )
  }
}
