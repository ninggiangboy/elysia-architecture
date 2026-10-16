import type { AccountDto, IdentityApi } from '#/modules/identity/contracts'
import { NotFoundError } from '#/shared/application/errors'
import type { Clock } from '#/shared/application/ports'
import { Profile } from '../domain/profile'
import type { ProfileRepository } from '../domain/profile-repository'

/**
 * Loads the account (via identity's contract) and the profile. If there is no profile yet (welcome event not yet processed),
 * returns an unpersisted default (version 0) — the system tolerates eventual consistency.
 */
export class ProfileLoader {
  constructor(
    private identity: IdentityApi,
    private profiles: ProfileRepository,
    private clock: Clock,
  ) {}

  async load(userId: string): Promise<{ account: AccountDto; profile: Profile }> {
    const [account, existing] = await Promise.all([
      this.identity.getAccount(userId),
      this.profiles.findByUserId(userId),
    ])
    if (!account) throw new NotFoundError('user_not_found', 'User not found')
    const profile =
      existing ?? Profile.createDefault({ userId, email: account.email, now: this.clock.now() })
    return { account, profile }
  }
}
