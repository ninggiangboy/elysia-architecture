import { NotFoundError } from '@kit/core'
import type {
  OAuthAccountRepository,
  PasskeyRepository,
  UserRepository,
} from '../domain/repositories'
import { assertKeepsASignInMethod } from '../domain/sign-in-methods'
import type { AuthPolicy } from './auth-policy'

/** Run before removing a password, a passkey or a provider: what is left must still let the person in. */
export class SignInMethodGuard {
  constructor(
    private users: UserRepository,
    private passkeys: PasskeyRepository,
    private oauthAccounts: OAuthAccountRepository,
    private policy: AuthPolicy,
  ) {}

  async assertKeepsOne(userId: string, removing: 'password' | 'passkey' | 'oauth'): Promise<void> {
    const [user, passkeys, accounts] = await Promise.all([
      this.users.findById(userId),
      this.passkeys.listByUser(userId),
      this.oauthAccounts.listByUser(userId),
    ])
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    assertKeepsASignInMethod({
      emailSignIn: this.policy.has('email'),
      password: this.policy.has('password') && user.hasPassword && removing !== 'password',
      passkeys: removing === 'passkey' ? passkeys.length - 1 : passkeys.length,
      oauthAccounts: removing === 'oauth' ? accounts.length - 1 : accounts.length,
    })
  }
}
